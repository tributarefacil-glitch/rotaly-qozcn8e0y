import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

try {
  const pkgPath = path.join(rootDir, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))
  const version = pkg.version || '0.0.342'
  const versionPayload = JSON.stringify(
    {
      version,
      buildTime: new Date().toISOString(),
    },
    null,
    2,
  )

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
