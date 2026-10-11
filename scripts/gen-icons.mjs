import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

const crcTable = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) {
    if (c & 1) c = 0xedb88320 ^ (c >>> 1)
    else c = c >>> 1
  }
  crcTable[n] = c >>> 0
}

function crc32(buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function makePngChunk(type, data) {
  const len = data.length
  const buf = Buffer.alloc(4 + 4 + len + 4)
  buf.writeUInt32BE(len, 0)
  buf.write(type, 4, 4, 'ascii')
  data.copy(buf, 8)
  const crcTarget = buf.subarray(4, 8 + len)
  buf.writeUInt32BE(crc32(crcTarget), 8 + len)
  return buf
}

function createRotalyPngIcon(size, isRound = false) {
  const width = size
  const height = size
  const center = size / 2
  const maxRadius = size / 2

  const rowStride = 1 + width * 4
  const rawBuf = Buffer.alloc(height * rowStride)

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowStride
    rawBuf[rowOffset] = 0

    for (let x = 0; x < width; x++) {
      const pixelOffset = rowOffset + 1 + x * 4

      const nx = x / (width - 1)
      const ny = y / (height - 1)

      const dx = x - center + 0.5
      const dy = y - center + 0.5
      const distFromCenter = Math.sqrt(dx * dx + dy * dy)

      let insideBg = false
      if (isRound) {
        insideBg = distFromCenter <= maxRadius - 0.5
      } else {
        const cornerR = size * 0.22
        const inLeftCorner = x < cornerR
        const inRightCorner = x > width - 1 - cornerR
        const inTopCorner = y < cornerR
        const inBottomCorner = y > height - 1 - cornerR

        if ((inLeftCorner || inRightCorner) && (inTopCorner || inBottomCorner)) {
          const cx = inLeftCorner ? cornerR : width - 1 - cornerR
          const cy = inTopCorner ? cornerR : height - 1 - cornerR
          insideBg = Math.hypot(x - cx, y - cy) <= cornerR
        } else {
          insideBg = true
        }
      }

      if (!insideBg) {
        rawBuf[pixelOffset] = 0
        rawBuf[pixelOffset + 1] = 0
        rawBuf[pixelOffset + 2] = 0
        rawBuf[pixelOffset + 3] = 0
        continue
      }

      let r = 27
      let g = 58
      let b = 140
      let a = 255

      const inSpine = nx >= 0.22 && nx <= 0.35 && ny >= 0.2 && ny <= 0.76
      const inUpperArm = nx >= 0.35 && nx <= 0.62 && ny >= 0.2 && ny <= 0.32
      const inMidArm = nx >= 0.35 && nx <= 0.6 && ny >= 0.44 && ny <= 0.54

      const loopDx = nx - 0.6
      const loopDy = ny - 0.37
      const loopDist = Math.hypot(loopDx, loopDy)
      const inLoop = loopDist <= 0.17 && loopDist >= 0.06 && nx >= 0.58

      const legX1 = 0.44,
        legY1 = 0.5,
        legX2 = 0.76,
        legY2 = 0.78
      const legVx = legX2 - legX1,
        legVy = legY2 - legY1
      const legLenSq = legVx * legVx + legVy * legVy
      const t = Math.max(0, Math.min(1, ((nx - legX1) * legVx + (ny - legY1) * legVy) / legLenSq))
      const projX = legX1 + t * legVx
      const projY = legY1 + t * legVy
      const inLeg = Math.hypot(nx - projX, ny - projY) <= 0.075 && ny >= 0.48 && ny <= 0.78

      const c1x1 = 0.2,
        c1y1 = 0.78,
        c1x2 = 0.44,
        c1y2 = 0.66
      const c1vx = c1x2 - c1x1,
        c1vy = c1y2 - c1y1
      const c1LenSq = c1vx * c1vx + c1vy * c1vy
      const t1 = Math.max(0, Math.min(1, ((nx - c1x1) * c1vx + (ny - c1y1) * c1vy) / c1LenSq))
      const inChevron1 = Math.hypot(nx - (c1x1 + t1 * c1vx), ny - (c1y1 + t1 * c1vy)) <= 0.038

      const c2x1 = 0.44,
        c2y1 = 0.66,
        c2x2 = 0.8,
        c2y2 = 0.84
      const c2vx = c2x2 - c2x1,
        c2vy = c2y2 - c2y1
      const c2LenSq = c2vx * c2vx + c2vy * c2vy
      const t2 = Math.max(0, Math.min(1, ((nx - c2x1) * c2vx + (ny - c2y1) * c2vy) / c2LenSq))
      const inChevron2 = Math.hypot(nx - (c2x1 + t2 * c2vx), ny - (c2y1 + t2 * c2vy)) <= 0.038

      if (inSpine || inUpperArm || inMidArm || inLoop || inLeg) {
        r = 255
        g = 255
        b = 255
      } else if (inChevron1 || inChevron2) {
        r = 0
        g = 168
        b = 232
      }

      rawBuf[pixelOffset] = r
      rawBuf[pixelOffset + 1] = g
      rawBuf[pixelOffset + 2] = b
      rawBuf[pixelOffset + 3] = a
    }
  }

  const compressedData = zlib.deflateSync(rawBuf)
  const pngSig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(width, 0)
  ihdrData.writeUInt32BE(height, 4)
  ihdrData[8] = 8
  ihdrData[9] = 6
  ihdrData[10] = 0
  ihdrData[11] = 0
  ihdrData[12] = 0
  const ihdrChunk = makePngChunk('IHDR', ihdrData)
  const idatChunk = makePngChunk('IDAT', compressedData)
  const iendChunk = makePngChunk('IEND', Buffer.alloc(0))

  return Buffer.concat([pngSig, ihdrChunk, idatChunk, iendChunk])
}

const densities = [
  { name: 'mipmap-mdpi', size: 48 },
  { name: 'mipmap-hdpi', size: 72 },
  { name: 'mipmap-xhdpi', size: 96 },
  { name: 'mipmap-xxhdpi', size: 144 },
  { name: 'mipmap-xxxhdpi', size: 192 },
]

const resBase = path.join(rootDir, 'android', 'app', 'src', 'main', 'res')

for (const { name, size } of densities) {
  const dirPath = path.join(resBase, name)
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
  fs.writeFileSync(path.join(dirPath, 'ic_launcher.png'), createRotalyPngIcon(size, false))
  fs.writeFileSync(path.join(dirPath, 'ic_launcher_round.png'), createRotalyPngIcon(size, true))
}

console.log('[gen-icons] Todos os mipmaps gerados com sucesso!')
