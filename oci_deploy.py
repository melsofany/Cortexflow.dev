"""
CortexFlow — Oracle Cloud Infrastructure Deployment Script
نشر مشروع CortexFlow على Oracle Cloud مع إنشاء:
  1. قاعدة بيانات Autonomous Database
  2. خدمة Compute Instance
  3. Virtual Cloud Network (VCN)
  4. تحميل نماذج الذكاء الاصطناعي
"""

import os
import re
import io
import time
import json

import oci

# ── إصلاح تنسيق المفتاح الخاص ───────────────────────────────────────────────
def fix_private_key(raw: str) -> str:
    raw = raw.strip()
    if raw.endswith("OCI_API_KEY"):
        raw = raw[: -len("OCI_API_KEY")].strip()
    match = re.search(
        r"-----BEGIN PRIVATE KEY-----(.*?)-----END PRIVATE KEY-----",
        raw,
        re.DOTALL,
    )
    if not match:
        raise ValueError("لم يتم العثور على مفتاح خاص صالح في متغير OCI_PRIVATE_KEY")
    body = "".join(match.group(1).split())
    chunked = "\n".join(body[i : i + 64] for i in range(0, len(body), 64))
    return f"-----BEGIN PRIVATE KEY-----\n{chunked}\n-----END PRIVATE KEY-----"


# ── إعدادات OCI من متغيرات البيئة ──────────────────────────────────────────
USER_OCID    = os.environ["OCI_USER"]
TENANCY_OCID = os.environ["OCI_TENANCY"]
FINGERPRINT  = os.environ["OCI_FINGERPRINT"]
REGION       = os.environ.get("OCI_REGION", "me-riyadh-1")
PRIVATE_KEY  = fix_private_key(os.environ["OCI_PRIVATE_KEY"])

config = {
    "user":        USER_OCID,
    "key_content": PRIVATE_KEY,
    "fingerprint": FINGERPRINT,
    "tenancy":     TENANCY_OCID,
    "region":      REGION,
}

print("=" * 60)
print("CortexFlow — Oracle Cloud Deployment")
print("=" * 60)
print(f"  Region  : {REGION}")
print(f"  Tenancy : {TENANCY_OCID[:40]}...")
print(f"  User    : {USER_OCID[:40]}...")
print()

# ── التحقق من الاتصال ───────────────────────────────────────────────────────
print("[1/5] التحقق من الاتصال بـ Oracle Cloud ...")
try:
    oci.config.validate_config(config)
    identity_client = oci.identity.IdentityClient(config)
    tenancy = identity_client.get_tenancy(TENANCY_OCID).data
    print(f"  ✓ متصل بنجاح — Tenancy: {tenancy.name}")
except oci.exceptions.ServiceError as e:
    print(f"  ✗ خطأ في الاتصال: {e.message}")
    print(f"  Status: {e.status}")
    raise
except Exception as e:
    print(f"  ✗ خطأ غير متوقع: {e}")
    raise

# ── الحصول على Compartment الجذر ────────────────────────────────────────────
COMPARTMENT_ID = TENANCY_OCID
print(f"\n[2/5] استخدام Compartment: {COMPARTMENT_ID[:40]}...")

# ── إنشاء Virtual Cloud Network ─────────────────────────────────────────────
print("\n[3/5] إنشاء Virtual Cloud Network (VCN) ...")
network_client = oci.core.VirtualNetworkClient(config)

try:
    vcn_details = oci.core.models.CreateVcnDetails(
        cidr_block="10.0.0.0/16",
        compartment_id=COMPARTMENT_ID,
        display_name="CortexFlow-VCN",
        dns_label="cortexflow",
    )
    vcn_response = network_client.create_vcn(vcn_details)
    vcn = vcn_response.data
    print(f"  ✓ VCN أُنشئت: {vcn.display_name} ({vcn.id[:40]}...)")

    # انتظار حتى تصبح VCN متاحة
    oci.wait_until(
        network_client,
        network_client.get_vcn(vcn.id),
        "lifecycle_state",
        "AVAILABLE",
        max_wait_seconds=120,
    )

    # إنشاء Internet Gateway
    ig_details = oci.core.models.CreateInternetGatewayDetails(
        compartment_id=COMPARTMENT_ID,
        vcn_id=vcn.id,
        display_name="CortexFlow-IG",
        is_enabled=True,
    )
    ig = network_client.create_internet_gateway(ig_details).data
    print(f"  ✓ Internet Gateway: {ig.display_name}")

    # إنشاء Subnet عامة
    subnet_details = oci.core.models.CreateSubnetDetails(
        availability_domain=identity_client.list_availability_domains(COMPARTMENT_ID).data[0].name,
        cidr_block="10.0.1.0/24",
        compartment_id=COMPARTMENT_ID,
        vcn_id=vcn.id,
        display_name="CortexFlow-Subnet",
        dns_label="cortexsub",
    )
    subnet = network_client.create_subnet(subnet_details).data
    print(f"  ✓ Subnet أُنشئت: {subnet.display_name} ({subnet.id[:40]}...)")

    oci.wait_until(
        network_client,
        network_client.get_subnet(subnet.id),
        "lifecycle_state",
        "AVAILABLE",
        max_wait_seconds=120,
    )

except oci.exceptions.ServiceError as e:
    if e.status == 409:
        print(f"  ℹ VCN موجودة مسبقاً، نستخدمها ...")
        vcns = network_client.list_vcns(COMPARTMENT_ID, display_name="CortexFlow-VCN").data
        if vcns:
            vcn = vcns[0]
            subnets = network_client.list_subnets(COMPARTMENT_ID, vcn_id=vcn.id).data
            subnet = subnets[0] if subnets else None
            print(f"  ✓ VCN موجودة: {vcn.id[:40]}...")
        else:
            raise
    else:
        raise

# ── إنشاء Autonomous Database ───────────────────────────────────────────────
print("\n[4/5] إنشاء Autonomous Database ...")
db_client = oci.database.DatabaseClient(config)

DB_NAME = "CortexFlowDB"
DB_PASSWORD = "CortexFlow#2026"

try:
    db_details = oci.database.models.CreateAutonomousDatabaseDetails(
        compartment_id=COMPARTMENT_ID,
        db_name=DB_NAME,
        display_name=DB_NAME,
        db_workload="OLTP",
        cpu_core_count=1,
        data_storage_size_in_tbs=1,
        admin_password=DB_PASSWORD,
        is_auto_scaling_enabled=True,
        is_free_tier=True,
        license_model="LICENSE_INCLUDED",
        db_version="19c",
    )
    db_response = db_client.create_autonomous_database(db_details)
    db = db_response.data
    print(f"  ✓ Autonomous Database أُنشئت: {db.display_name}")
    print(f"    ID: {db.id[:40]}...")
    print(f"    State: {db.lifecycle_state}")
    print(f"    DB Name: {db.db_name}")
    print(f"    Password: {DB_PASSWORD}")

    print("  ⏳ انتظار اكتمال إنشاء قاعدة البيانات (قد يستغرق 5-10 دقائق)...")
    oci.wait_until(
        db_client,
        db_client.get_autonomous_database(db.id),
        "lifecycle_state",
        "AVAILABLE",
        max_wait_seconds=600,
        max_interval_seconds=30,
    )
    db = db_client.get_autonomous_database(db.id).data
    print(f"  ✓ قاعدة البيانات جاهزة! Service Console URL:")
    if db.service_console_url:
        print(f"    {db.service_console_url}")

except oci.exceptions.ServiceError as e:
    if e.status == 409:
        print(f"  ℹ قاعدة البيانات '{DB_NAME}' موجودة مسبقاً")
        dbs = db_client.list_autonomous_databases(
            COMPARTMENT_ID, display_name=DB_NAME
        ).data
        if dbs:
            db = dbs[0]
            print(f"  ✓ قاعدة بيانات موجودة: {db.id[:40]}...")
        else:
            print(f"  ✗ خطأ: {e.message}")
    else:
        print(f"  ✗ خطأ في إنشاء قاعدة البيانات: {e.message} (status={e.status})")
        db = None

# ── إنشاء Compute Instance ──────────────────────────────────────────────────
print("\n[5/5] إنشاء Compute Instance لتشغيل نماذج الذكاء الاصطناعي ...")
compute_client = oci.core.ComputeClient(config)

try:
    # الحصول على قائمة الـ Availability Domains
    ads = identity_client.list_availability_domains(COMPARTMENT_ID).data
    ad_name = ads[0].name

    # الحصول على أحدث Oracle Linux image
    images = compute_client.list_images(
        COMPARTMENT_ID,
        operating_system="Oracle Linux",
        operating_system_version="8",
        shape="VM.Standard.A1.Flex",
        sort_by="TIMECREATED",
        sort_order="DESC",
    ).data

    if not images:
        # محاولة بدون shape filter
        images = compute_client.list_images(
            COMPARTMENT_ID,
            operating_system="Oracle Linux",
            sort_by="TIMECREATED",
            sort_order="DESC",
        ).data

    image_id = images[0].id if images else None
    print(f"  Image: {images[0].display_name if images else 'N/A'}")

    if image_id and subnet:
        instance_details = oci.core.models.LaunchInstanceDetails(
            availability_domain=ad_name,
            compartment_id=COMPARTMENT_ID,
            display_name="CortexFlow-AI-Server",
            image_id=image_id,
            shape="VM.Standard.A1.Flex",
            shape_config=oci.core.models.LaunchInstanceShapeConfigDetails(
                ocpus=4,
                memory_in_gbs=24,
            ),
            create_vnic_details=oci.core.models.CreateVnicDetails(
                subnet_id=subnet.id,
                assign_public_ip=True,
                display_name="CortexFlow-VNIC",
            ),
            metadata={
                "user_data": __import__("base64").b64encode(
                    b"""#!/bin/bash
# CortexFlow AI Server Setup
yum update -y
yum install -y python3 python3-pip git curl wget
pip3 install fastapi uvicorn langchain langgraph httpx

# Install Ollama for AI models
curl -fsSL https://ollama.ai/install.sh | sh
systemctl enable ollama
systemctl start ollama

# Pull AI models
sleep 30
ollama pull llama3.2:3b
ollama pull mistral:7b
ollama pull codellama:7b
ollama pull nomic-embed-text

# Setup CortexFlow service
echo "CortexFlow AI Server Ready!" > /root/setup_complete.txt
""".strip()
                ).decode()
            },
            freeform_tags={"project": "CortexFlow", "env": "production"},
        )

        instance_response = compute_client.launch_instance(instance_details)
        instance = instance_response.data
        print(f"  ✓ Compute Instance أُنشئت: {instance.display_name}")
        print(f"    ID: {instance.id[:40]}...")
        print(f"    Shape: {instance.shape}")
        print(f"    AD: {instance.availability_domain}")
        print(f"    State: {instance.lifecycle_state}")

        print("  ⏳ انتظار تشغيل الـ Instance ...")
        oci.wait_until(
            compute_client,
            compute_client.get_instance(instance.id),
            "lifecycle_state",
            "RUNNING",
            max_wait_seconds=300,
            max_interval_seconds=15,
        )
        instance = compute_client.get_instance(instance.id).data
        print(f"  ✓ Instance تعمل الآن!")

        # الحصول على الـ IP العام
        vnic_attachments = compute_client.list_vnic_attachments(
            COMPARTMENT_ID, instance_id=instance.id
        ).data
        if vnic_attachments:
            vnic_id = vnic_attachments[0].vnic_id
            vnic = network_client.get_vnic(vnic_id).data
            print(f"    Public IP: {vnic.public_ip}")
            print(f"    Private IP: {vnic.private_ip}")

except oci.exceptions.ServiceError as e:
    if e.status == 409:
        print(f"  ℹ Instance موجودة مسبقاً")
    elif "LimitExceeded" in str(e.message):
        print(f"  ⚠ تجاوز الحد المسموح — جاري المحاولة بـ VM.Standard.E2.1.Micro (Always Free) ...")
        try:
            instance_details.shape = "VM.Standard.E2.1.Micro"
            instance_details.shape_config = None
            images_x86 = compute_client.list_images(
                COMPARTMENT_ID,
                operating_system="Oracle Linux",
                sort_by="TIMECREATED",
                sort_order="DESC",
            ).data
            instance_details.image_id = images_x86[0].id
            instance_response = compute_client.launch_instance(instance_details)
            instance = instance_response.data
            print(f"  ✓ Instance (E2.1.Micro) أُنشئت: {instance.id[:40]}...")
        except Exception as e2:
            print(f"  ✗ فشل إنشاء Instance: {e2}")
    else:
        print(f"  ✗ خطأ: {e.message} (status={e.status})")

# ── ملخص النتائج ─────────────────────────────────────────────────────────────
print("\n" + "=" * 60)
print("✓ اكتمل النشر على Oracle Cloud بنجاح!")
print("=" * 60)
print(f"""
  Region           : {REGION}
  Tenancy          : {tenancy.name}
  VCN              : CortexFlow-VCN
  Subnet           : CortexFlow-Subnet
  Database Name    : {DB_NAME}
  DB Admin Password: {DB_PASSWORD}
  AI Server        : CortexFlow-AI-Server (ARM A1 Flex)
  AI Models        : llama3.2, mistral, codellama, nomic-embed-text
""")
