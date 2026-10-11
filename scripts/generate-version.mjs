import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

try {
  const pkgPath = path.join(rootDir, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
  const version = pkg.version || '0.0.350'
  const now = new Date()
  const yyyy = now.getUTCFullYear()
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(now.getUTCDate()).padStart(2, '0')
  const buildDateStr = `${yyyy}-${mm}-${dd}`
  const buildIdentifier = `${buildDateStr}.01`

  const versionPayload = JSON.stringify(
    {
      version,
      build: buildIdentifier,
      buildTime: now.toISOString(),
    },
    null,
    2,
  )

  // Executa gen-icons se os arquivos não existirem
  const mdpiFile = path.join(
    rootDir,
    'android',
    'app',
    'src',
    'main',
    'res',
    'mipmap-mdpi',
    'ic_launcher.png',
  )
  if (!fs.existsSync(mdpiFile)) {
    const genIconsScript = path.join(rootDir, 'scripts', 'gen-icons.mjs')
    if (fs.existsSync(genIconsScript)) {
      await import('./gen-icons.mjs')
    }
  }

  // 1. Sempre grava em public/version.json para que o Vite copie para qualquer build
  const publicDir = path.join(rootDir, 'public')
  if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir, { recursive: true })
  }
  fs.writeFileSync(path.join(publicDir, 'version.json'), versionPayload)
  console.log(`[generate-version] public/version.json gerado com sucesso (v${version})`)

  // 2. Se já existirem dist ou dev-dist, sincroniza também diretamente
  for (const dirName of ['dist', 'dev-dist']) {
    const targetDir = path.join(rootDir, dirName)
    if (fs.existsSync(targetDir)) {
      fs.writeFileSync(path.join(targetDir, 'version.json'), versionPayload)
    }
  }
} catch (err) {
  console.error('[generate-version] Erro ao gerar version.json:', err)
  process.exit(1)
}
