import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export { cloudinary };

export async function uploadImage(
  dataUrl: string,
  folder: string = "modern-mesh"
): Promise<string> {
  const result = await cloudinary.uploader.upload(dataUrl, {
    folder,
    resource_type: "image",
  });

  return result.secure_url;
}

export async function uploadPdf(
  buffer: Buffer,
  filename: string,
  folder: string = "modern-mesh/pdfs"
): Promise<string> {
  const base64 = buffer.toString("base64");
  const dataUrl = `data:application/pdf;base64,${base64}`;

  const result = await cloudinary.uploader.upload(dataUrl, {
    folder,
    resource_type: "raw",
    public_id: filename.replace(".pdf", ""),
    format: "pdf",
  });

  return result.secure_url;
}

export async function deleteResource(publicId: string): Promise<void> {
  await cloudinary.uploader.destroy(publicId);
}
