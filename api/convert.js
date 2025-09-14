// api/convert.js
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import formidable from "formidable";
import ffmpegPath from "ffmpeg-static";

export const config = {
  api: { bodyParser: false }
};

function runFFmpeg(args, onStdout, onStderr) {
  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpegPath, args);
    let stderr = "";
    let stdout = "";
    ff.stdout.on("data", (d) => {
      stdout += d.toString();
      if (onStdout) onStdout(d.toString());
    });
    ff.stderr.on("data", (d) => {
      stderr += d.toString();
      if (onStderr) onStderr(d.toString());
    });
    ff.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`ffmpeg exited ${code}\n${stderr}`));
    });
    ff.on("error", (err) => reject(err));
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }
  const form = new formidable.IncomingForm({
    uploadDir: os.tmpdir(),
    keepExtensions: true,
    maxFileSize: 1024 * 1024 * 1024
  });

  form.parse(req, async (err, fields, files) => {
    if (err) {
      res.status(400).json({ error: err.message });
      return;
    }
    const fileKey = Object.keys(files)[0];
    if (!fileKey) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }
    const uploaded = files[fileKey];
    const inputPath = uploaded.filepath || uploaded.path || uploaded.file;
    const inputName = path.basename(inputPath);
    const outName = `${path.parse(inputName).name}-h265.mp4`;
    const outPath = path.join(os.tmpdir(), outName);
    try {
      const args = [
        "-y",
        "-i", inputPath,
        "-c:v", "libx265",
        "-preset", "fast",
        "-crf", "28",
        "-c:a", "aac",
        "-b:a", "128k",
        outPath
      ];
      await runFFmpeg(args);
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Content-Disposition", `attachment; filename=\"${outName}\"`);
      const readStream = fs.createReadStream(outPath);
      readStream.pipe(res);
      readStream.on("close", () => {
        try { fs.unlinkSync(inputPath); } catch {}
        try { fs.unlinkSync(outPath); } catch {}
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
      try { fs.unlinkSync(inputPath); } catch {}
      try { fs.unlinkSync(outPath); } catch {}
    }
  });
}
