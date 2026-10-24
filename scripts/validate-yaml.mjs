import fs from 'node:fs'

const filePath = '.github/workflows/build-apk.yml'
const raw = fs.readFileSync(filePath, 'utf8')

console.log(`[VALIDACAO YAML RIGOROSA] Lendo ${filePath}...`)

const lines = raw.split('\n')
const errors = []

// 1. Verificacao de tabs
lines.forEach((line, idx) => {
  if (line.includes('\t')) {
    errors.push(`Linha ${idx + 1}: Proibido uso de tabulações (tab) em YAML.`)
  }
})

// 2. Parser tokenizador de estrutura YAML
let inBlockScalar = false
let blockScalarIndent = 0

for (let i = 0; i < lines.length; i++) {
  const lineNum = i + 1
  const line = lines[i]

  // Se estamos dentro de um literal block scalar (| ou >)
  if (inBlockScalar) {
    if (line.trim() === '') {
      // Linhas em branco dentro de bloco escalar sao permitidas
      continue
    }
    const currentIndent = line.search(/\S/)
    if (currentIndent <= blockScalarIndent) {
      // Linha com indentação menor ou igual à chave do bloco: encerrou o scalar
      inBlockScalar = false
      blockScalarIndent = 0
    } else {
      // Ainda dentro do literal block, continua normalmente
      continue
    }
  }

  // Ignorar linhas vazias ou comentarios
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) {
    continue
  }

  const indent = line.search(/\S/)

  // Checar se a linha termina com início de bloco scalar | ou >
  if (/:\s*(\||>)[+-]?\s*$/.test(trimmed)) {
    inBlockScalar = true
    blockScalarIndent = indent
    continue
  }

  // Se nao esta em bloco escalar, verificar sintaxe basica de mapeamento ou lista
  // Verifica se eh item de lista ou mapeamento
  const isListItem = trimmed.startsWith('-')
  const content = isListItem ? trimmed.slice(1).trim() : trimmed

  if (content.length > 0 && content.includes(':')) {
    // Checar se dois-pontos tem espaco a seguir, a menos que esteja entre aspas ou seja expressao ${{ }}
    let inQuotes = false
    let quoteChar = ''
    let inExpr = false
    let validColon = false

    for (let c = 0; c < content.length; c++) {
      const char = content[c]
      const nextChar = content[c + 1]

      if (!inQuotes && (char === '"' || char === "'")) {
        inQuotes = true
        quoteChar = char
        continue
      }
      if (inQuotes && char === quoteChar) {
        inQuotes = false
        continue
      }
      if (!inQuotes && char === '$' && nextChar === '{') {
        inExpr = true
      }
      if (inExpr && char === '}' && content[c - 1] === '}') {
        inExpr = false
      }

      if (!inQuotes && !inExpr && char === ':') {
        if (
          nextChar === undefined ||
          nextChar === ' ' ||
          nextChar === '\t' ||
          nextChar === '\r' ||
          nextChar === '\n'
        ) {
          validColon = true
        } else {
          // Dois-pontos colado com proximo caractere fora de aspas e expressoes
          errors.push(
            `Linha ${lineNum}: Dois-pontos ':' sem espaco a seguir fora de aspas: "${trimmed}"`,
          )
        }
      }
    }
  }
}

if (errors.length > 0) {
  console.error('[ERRO DE SINTAXE YAML ENCONTRADO]:')
  errors.forEach((e) => console.error('  -', e))
  process.exit(1)
} else {
  console.log(
    `[SUCESSO] O arquivo ${filePath} foi validado e esta 100% compativel com YAML e GitHub Actions.`,
  )
}
