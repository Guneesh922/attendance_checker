import os
import uuid
import cloudinary
import cloudinary.uploader

# Configure Cloudinary using environment variables as a fallback.
# Note: If CLOUDINARY_URL is set (like on Railway), the SDK auto-configures itself.
if os.environ.get("CLOUDINARY_CLOUD_NAME"):
    cloudinary.config(
        cloud_name = os.environ.get("CLOUDINARY_CLOUD_NAME"),
        api_key    = os.environ.get("CLOUDINARY_API_KEY"),
        api_secret = os.environ.get("CLOUDINARY_API_SECRET"),
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
