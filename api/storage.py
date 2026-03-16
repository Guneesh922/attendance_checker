import os
import uuid
import cloudinary
import cloudinary.uploader

cloudinary.config(
    cloud_name = "duksi8dar",
    api_key    = "817794938979822",
    api_secret = "gAX9cJLxnllU-pCy_25vL49LXQo",
    secure     = True
)

def upload_face_image(employee_name: str, image_bytes: bytes):
    """Upload JPEG bytes to Cloudinary, return (secure HTTPS URL, public_id)."""
    public_id = f"employees/{employee_name}/{uuid.uuid4().hex}"
    result = cloudinary.uploader.upload(
        image_bytes,
        public_id=public_id,
        resource_type="image",
        format="jpg"
    )
    return result["secure_url"], public_id

def delete_face_image(public_id: str):
    """Delete image by its public_id. Best-effort, does not raise."""
    try:
        if public_id:
            cloudinary.uploader.destroy(public_id)
    except Exception:
        pass
