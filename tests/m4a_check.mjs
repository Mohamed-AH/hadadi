/* worker/admin/m4a.mjs: AAC frames from ffmpeg (ADTS stripped) -> muxM4a -> ffprobe/ffmpeg read it back: codec, channels, rate,
   duration, every frame decodes, moov before mdat.   node tests/m4a_check.mjs  (needs ffmpeg) */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { muxM4a } from "../worker/admin/m4a.mjs";
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
const dir = fs.mkdtempSync("/tmp/claude-m4a-");
execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=300:duration=20", "-ac", "1", "-ar", "44100", "-c:a", "aac", "-b:a", "32k", "-f", "adts", `${dir}/a.aac`]);
const adts = fs.readFileSync(`${dir}/a.aac`), frames = [];
let asc;
for (let i = 0; i + 7 <= adts.length;) {
  const prot = adts[i + 1] & 1, len = ((adts[i + 3] & 3) << 11) | (adts[i + 4] << 3) | (adts[i + 5] >> 5), hdr = prot ? 7 : 9;
  if (!asc) { const prof = (adts[i + 2] >> 6) + 1, sr = (adts[i + 2] >> 2) & 15, ch = ((adts[i + 2] & 1) << 2) | (adts[i + 3] >> 6); asc = Uint8Array.from([(prof << 3) | (sr >> 1), ((sr & 1) << 7) | (ch << 3)]); }
  frames.push(new Uint8Array(adts.subarray(i + hdr, i + len))); i += len;
}
const out = muxM4a({ sampleRate: 44100, channels: 1, asc, frames, bitrate: 32000 });
fs.writeFileSync(`${dir}/o.m4a`, out);
const info = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", `${dir}/o.m4a`], { encoding: "utf8" }));
const s = info.streams[0];
ok(s.codec_name === "aac" && s.channels === 1 && s.sample_rate === "44100", "aac mono 44.1 kHz");
ok(Math.abs(parseFloat(info.format.duration) - 20) < 0.2, "duration ~20 s: " + info.format.duration);
ok(/mov|mp4|m4a/.test(info.format.format_name), "MP4 family");
const err = execFileSync("ffmpeg", ["-v", "error", "-i", `${dir}/o.m4a`, "-f", "null", "-"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
ok(err.trim() === "", "every frame decodes: " + err);
const txt = Buffer.from(out).toString("latin1");
ok(txt.indexOf("moov") < txt.indexOf("mdat") && txt.slice(4, 8) === "ftyp", "ftyp, then moov before mdat (faststart)");
ok(out[4] === 0x66 && out[5] === 0x74 && out[6] === 0x79 && out[7] === 0x70, "passes the upload sniff (ftyp at byte 4)");
ok(!/\bimport\b|\bexport\b/.test(muxM4a.toString().slice(muxM4a.toString().indexOf("{"))), "function body is self-contained for the browser");
fs.rmSync(dir, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
