/* A minimal MP4 audio writer for the portal's in-browser compression (client.mjs embeds this function's source, so it must stay
   self-contained: no imports, no outer variables). One AAC track, every frame in one chunk, moov before mdat ("faststart"),
   so the file starts playing before it is fully downloaded, like the m4a files tools/fetch_audio.py writes.
   muxM4a({ sampleRate, channels, asc: Uint8Array (AudioSpecificConfig), frames: Uint8Array[], frameSamples = 1024, bitrate })
   -> Uint8Array */
export function muxM4a({ sampleRate, channels = 1, asc, frames, frameSamples = 1024, bitrate = 48000 }) {
  const u8 = (...b) => Uint8Array.from(b);
  const u16 = v => u8(v >>> 8 & 255, v & 255);
  const u32 = v => u8(v >>> 24 & 255, v >>> 16 & 255, v >>> 8 & 255, v & 255);
  const str = s => Uint8Array.from(s, c => c.charCodeAt(0));
  const cat = parts => { let n = 0; for (const p of parts) n += p.length; const o = new Uint8Array(n); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };
  const box = (type, ...kids) => { const body = cat(kids); return cat([u32(body.length + 8), str(type), body]); };
  const full = (type, v, flags, ...kids) => box(type, u8(v, flags >>> 16 & 255, flags >>> 8 & 255, flags & 255), ...kids);
  const zeros = n => new Uint8Array(n);
  const matrix = cat([u32(0x10000), u32(0), u32(0), u32(0), u32(0x10000), u32(0), u32(0), u32(0), u32(0x40000000)]);
  const desc = (tag, body) => cat([u8(tag, body.length), body]);            // every descriptor here is < 128 bytes

  const n = frames.length, total = n * frameSamples;
  let maxFrame = 0, bytes = 0;
  for (const f of frames) { bytes += f.length; if (f.length > maxFrame) maxFrame = f.length; }
  const esds = full("esds", 0, 0, desc(3, cat([u16(1), u8(0),
    desc(4, cat([u8(0x40, 0x15), u8(maxFrame >>> 16 & 255, maxFrame >>> 8 & 255, maxFrame & 255), u32(bitrate), u32(bitrate), desc(5, asc)])),
    desc(6, u8(2))])));
  const mp4a = box("mp4a", zeros(6), u16(1), zeros(8), u16(channels), u16(16), u16(0), u16(0), u32(sampleRate * 65536 >>> 0), esds);
  const sizes = new Uint8Array(n * 4);
  frames.forEach((f, i) => { sizes[i * 4] = f.length >>> 24 & 255; sizes[i * 4 + 1] = f.length >>> 16 & 255; sizes[i * 4 + 2] = f.length >>> 8 & 255; sizes[i * 4 + 3] = f.length & 255; });
  const moovWith = offset => box("moov",
    full("mvhd", 0, 0, u32(0), u32(0), u32(sampleRate), u32(total), u32(0x10000), u16(0x100), zeros(10), matrix, zeros(24), u32(2)),
    box("trak",
      full("tkhd", 0, 3, u32(0), u32(0), u32(1), u32(0), u32(total), zeros(8), u16(0), u16(0), u16(0x100), u16(0), matrix, u32(0), u32(0)),
      box("mdia",
        full("mdhd", 0, 0, u32(0), u32(0), u32(sampleRate), u32(total), u16(0x55c4), u16(0)),
        full("hdlr", 0, 0, u32(0), str("soun"), zeros(12), str("SoundHandler\0")),
        box("minf",
          full("smhd", 0, 0, u16(0), u16(0)),
          box("dinf", full("dref", 0, 0, u32(1), full("url ", 0, 1))),
          box("stbl",
            full("stsd", 0, 0, u32(1), mp4a),
            full("stts", 0, 0, u32(1), u32(n), u32(frameSamples)),
            full("stsc", 0, 0, u32(1), u32(1), u32(n), u32(1)),
            full("stsz", 0, 0, u32(0), u32(n), sizes),
            full("stco", 0, 0, u32(1), u32(offset)))))));
  const ftyp = box("ftyp", str("M4A "), u32(0x200), str("M4A "), str("isom"), str("iso2"), str("mp41"));
  const moov = moovWith(0), offset = ftyp.length + moov.length + 8;   // the offset is a fixed-size field: the length does not change
  const out = new Uint8Array(offset + bytes);
  out.set(ftyp, 0); out.set(moovWith(offset), ftyp.length);
  out.set(u32(bytes + 8), offset - 8); out.set(str("mdat"), offset - 4);
  let i = offset; for (const f of frames) { out.set(f, i); i += f.length; }
  return out;
}
