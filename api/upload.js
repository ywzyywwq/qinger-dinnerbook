import { put } from '@vercel/blob';

export default async function handler(req, res) {
  // Only allow PUT with raw file body for maximum simplicity & performance.
  if (req.method !== 'PUT') {
    res.setHeader('Allow', 'PUT');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  try {
    const filename = (req.query.filename || 'upload.bin').toString();
    const contentType = (req.headers['content-type'] || 'application/octet-stream').toString();
    // Put supports Node.js streams directly. access: 'public' returns a public URL.
    const blob = await put(`qinger-recipes/${Date.now()}-${filename}`, req, {
      access: 'public',
      contentType
    });
    return res.status(200).json({ url: blob.url });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Upload failed', detail: String(err) });
  }
}
