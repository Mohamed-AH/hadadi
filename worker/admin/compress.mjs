/* In-browser audio compression for the portal's upload forms (owner 2026-11-19): mp3 / m4a -> mono AAC-LC 48 kbps m4a, the same
   kind of file tools/fetch_audio.py writes, using the browser's own WebCodecs decoder and encoder (nothing third-party). The source
   is demuxed here (mp3 frames, or the MP4 sample table), decoded, mixed to mono, resampled with linear interpolation, encoded,
   and written by muxM4a (m4a.mjs). compress() returns null whenever the browser can't (no WebCodecs, no AAC encoder: e.g. Linux
   Chromium, older Safari), and the caller then uploads the original file. Built from plain functions so tests can load it. */
import { muxM4a } from "./m4a.mjs";

export const COMPRESS_SRC = String.raw`
const KBPS = 48;
/* ---- demux ---- */
const MP3_BR = { 1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };
const MP3_SR = [44100, 48000, 32000];
function mp3Header(b, i) {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
  const ver = b[i + 1] >> 3 & 3, layer = b[i + 1] >> 1 & 3, bri = b[i + 2] >> 4, sri = b[i + 2] >> 2 & 3, pad = b[i + 2] >> 1 & 1;
  if (ver === 1 || layer !== 1 || bri === 0 || bri === 15 || sri === 3) return null;   // Layer III only, no free format
  const v1 = ver === 3, sr = MP3_SR[sri] / (v1 ? 1 : ver === 2 ? 2 : 4), br = MP3_BR[v1 ? 1 : 2][bri] * 1000;
  return { size: Math.floor((v1 ? 144 : 72) * br / sr) + pad, sr, ch: (b[i + 3] >> 6) === 3 ? 1 : 2, spf: v1 ? 1152 : 576 };
}
function mp3Frames(b) {
  let i = 0;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) i = 10 + ((b[6] & 127) << 21 | (b[7] & 127) << 14 | (b[8] & 127) << 7 | (b[9] & 127)) + (b[5] & 16 ? 10 : 0);
  const frames = []; let first = null;
  while (i + 4 <= b.length) {
    const h = mp3Header(b, i);
    if (!h || i + h.size > b.length || (!first && !mp3Header(b, i + h.size) && i + h.size < b.length)) { i++; continue; }
    if (!first) first = h;
    if (h.sr === first.sr) frames.push({ o: i, n: h.size, spf: h.spf });
    i += h.size;
  }
  return frames.length > 10 ? { config: { codec: "mp3", sampleRate: first.sr, numberOfChannels: first.ch }, frames, sr: first.sr } : null;
}
function boxes(b, s, e) {                                   // [{type, s (body start), e}]
  const out = [], dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  while (s + 8 <= e) {
    let size = dv.getUint32(s), hdr = 8;
    const type = String.fromCharCode(b[s + 4], b[s + 5], b[s + 6], b[s + 7]);
    if (size === 1) { size = dv.getUint32(s + 8) * 4294967296 + dv.getUint32(s + 12); hdr = 16; } else if (size === 0) size = e - s;
    if (size < hdr || s + size > e) break;
    out.push({ type, s: s + hdr, e: s + size }); s += size;
  }
  return out;
}
const child = (b, box, type) => boxes(b, box.s, box.e).find(x => x.type === type);
function m4aFrames(b) {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const moov = boxes(b, 0, b.length).find(x => x.type === "moov"); if (!moov) return null;
  for (const trak of boxes(b, moov.s, moov.e).filter(x => x.type === "trak")) {
    const mdia = child(b, trak, "mdia"), hdlr = mdia && child(b, mdia, "hdlr");
    if (!hdlr || String.fromCharCode(...b.subarray(hdlr.s + 8, hdlr.s + 12)) !== "soun") continue;
    const stbl = child(b, child(b, mdia, "minf"), "stbl"), stsd = child(b, stbl, "stsd");
    const entry = boxes(b, stsd.s + 8, stsd.e)[0]; if (!entry || entry.type !== "mp4a") return null;
    const ch = dv.getUint16(entry.s + 16), sr = dv.getUint32(entry.s + 24) >>> 16;
    const esds = boxes(b, entry.s + 28, entry.e).find(x => x.type === "esds"); if (!esds) return null;
    let p = esds.s + 4, asc = null;
    const desc = () => { const tag = b[p++]; let len = 0, c; do { c = b[p++]; len = len << 7 | c & 127; } while (c & 128); return { tag, len }; };
    let d = desc(); if (d.tag !== 3) return null;
    const fl = b[p + 2]; p += 3; if (fl & 128) p += 2; if (fl & 64) p += 1 + b[p]; if (fl & 32) p += 2;
    d = desc(); if (d.tag !== 4) return null; p += 13;
    d = desc(); if (d.tag !== 5) return null; asc = b.slice(p, p + d.len);
    const stsz = child(b, stbl, "stsz"), stsc = child(b, stbl, "stsc"), stco = child(b, stbl, "stco") || child(b, stbl, "co64");
    const fixed = dv.getUint32(stsz.s + 4), n = dv.getUint32(stsz.s + 8), sizes = [];
    for (let k = 0; k < n; k++) sizes.push(fixed || dv.getUint32(stsz.s + 12 + 4 * k));
    const nc = dv.getUint32(stco.s + 4), big = stco.type === "co64", offs = [];
    for (let k = 0; k < nc; k++) offs.push(big ? dv.getUint32(stco.s + 8 + 8 * k) * 4294967296 + dv.getUint32(stco.s + 12 + 8 * k) : dv.getUint32(stco.s + 8 + 4 * k));
    const runs = []; for (let k = 0, m = dv.getUint32(stsc.s + 4); k < m; k++) runs.push([dv.getUint32(stsc.s + 8 + 12 * k), dv.getUint32(stsc.s + 12 + 12 * k)]);
    const frames = []; let si = 0;
    for (let c = 0; c < nc && si < n; c++) {
      let per = 0; for (const [first, count] of runs) if (first - 1 <= c) per = count;
      let o = offs[c];
      for (let k = 0; k < per && si < n; k++, si++) { if (o + sizes[si] > b.length) return null; frames.push({ o, n: sizes[si], spf: 1024 }); o += sizes[si]; }
    }
    const aot = asc[0] >> 3;
    return frames.length > 10 ? { config: { codec: "mp4a.40." + (aot === 31 ? 2 : aot), sampleRate: sr, numberOfChannels: ch || 1, description: asc }, frames, sr } : null;
  }
  return null;
}

/* ---- encode ---- */
const SR_INDEX = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000];
const lcConfig = (sr, ch) => { const i = SR_INDEX.indexOf(sr); return Uint8Array.from([2 << 3 | i >> 1, (i & 1) << 7 | ch << 3]); };
async function encoderConfig() {
  if (typeof AudioEncoder === "undefined" || typeof AudioDecoder === "undefined") return null;
  for (const sampleRate of [44100, 48000]) for (const kbps of [KBPS, 64]) {
    const c = { codec: "mp4a.40.2", sampleRate, numberOfChannels: 1, bitrate: kbps * 1000 };
    try { if ((await AudioEncoder.isConfigSupported(c)).supported) return c; } catch {}
  }
  return null;
}
const idle = () => new Promise(r => setTimeout(r, 0));

/* -> { blob, seconds, kbps } or null (then upload the original) */
async function compress(file, progress) {
  const ext = file.name.split(".").pop().toLowerCase();
  const enc = await encoderConfig(); if (!enc) return null;
  const b = new Uint8Array(await file.arrayBuffer());
  const src = ext === "mp3" ? mp3Frames(b) : m4aFrames(b); if (!src) return null;
  try { if (!(await AudioDecoder.isConfigSupported(src.config)).supported) return null; } catch { return null; }
  const OUT = enc.sampleRate, BLOCK = 4096, out = []; let asc = null, failed = null, written = 0;
  const encoder = new AudioEncoder({ output: (chunk, meta) => {
    if (meta && meta.decoderConfig && meta.decoderConfig.description && !asc) asc = new Uint8Array(meta.decoderConfig.description.buffer || meta.decoderConfig.description).slice();
    const x = new Uint8Array(chunk.byteLength); chunk.copyTo(x); out.push(x);
  }, error: e => { failed = e; } });
  encoder.configure(enc);
  let pend = new Float32Array(0), pos = 0, acc = new Float32Array(BLOCK), fill = 0;
  const push = mono => {                                     // resample to OUT and feed the encoder in BLOCK-sized pieces
    const inRate = push.rate; if (inRate === OUT) { emit(mono); return; }
    const all = new Float32Array(pend.length + mono.length); all.set(pend); all.set(mono, pend.length);
    const step = inRate / OUT, res = [];
    for (; pos + 1 < all.length; pos += step) { const i = Math.floor(pos), f = pos - i; res.push(all[i] * (1 - f) + all[i + 1] * f); }
    const drop = Math.floor(pos); pend = all.slice(drop); pos -= drop;
    emit(Float32Array.from(res));
  };
  const emit = s => {
    for (let k = 0; k < s.length;) {
      const n = Math.min(BLOCK - fill, s.length - k); acc.set(s.subarray(k, k + n), fill); fill += n; k += n;
      if (fill === BLOCK) flushBlock();
    }
  };
  const flushBlock = () => {
    if (!fill) return;
    const data = acc.slice(0, fill);
    const ad = new AudioData({ format: "f32-planar", sampleRate: OUT, numberOfFrames: fill, numberOfChannels: 1, timestamp: Math.round(written / OUT * 1e6), data });
    encoder.encode(ad); ad.close(); written += fill; fill = 0;
  };
  const decoder = new AudioDecoder({ output: ad => {
    try {
      const n = ad.numberOfFrames, ch = ad.numberOfChannels, mono = new Float32Array(n), tmp = new Float32Array(n);
      for (let c = 0; c < ch; c++) { ad.copyTo(tmp, { planeIndex: c, format: "f32-planar" }); for (let k = 0; k < n; k++) mono[k] += tmp[k] / ch; }
      push.rate = ad.sampleRate; push(mono);
    } catch (e) { failed = e; } finally { ad.close(); }
  }, error: e => { failed = e; } });
  decoder.configure(src.config);
  let ts = 0;
  for (let k = 0; k < src.frames.length; k++) {
    if (failed) break;
    const f = src.frames[k];
    decoder.decode(new EncodedAudioChunk({ type: "key", timestamp: Math.round(ts), data: b.subarray(f.o, f.o + f.n) }));
    ts += f.spf / src.sr * 1e6;
    while ((decoder.decodeQueueSize > 20 || encoder.encodeQueueSize > 20) && !failed) await idle();
    if (k % 200 === 0) { progress(k / src.frames.length); await idle(); }
  }
  try { if (!failed) await decoder.flush(); flushBlock(); if (!failed) await encoder.flush(); } catch (e) { failed = failed || e; }
  try { decoder.close(); } catch {} try { encoder.close(); } catch {}
  if (failed || out.length < 10) { console.warn("compress: falling back to the original file", failed); return null; }
  const m4a = muxM4a({ sampleRate: OUT, channels: 1, asc: asc || lcConfig(OUT, 1), frames: out, bitrate: enc.bitrate });
  const seconds = Math.round(written / OUT);
  return { blob: new Blob([m4a], { type: "audio/mp4" }), seconds, kbps: enc.bitrate / 1000 };
}
`;

/* the browser bundle part: the muxer + the code above */
export const COMPRESS_JS = muxM4a.toString() + "\n" + COMPRESS_SRC;
