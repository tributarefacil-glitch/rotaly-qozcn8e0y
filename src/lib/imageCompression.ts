/**
 * Utilitários para compressão e otimização de imagens no cliente
 * antes do upload para o PocketBase, evitando falhas por estouro de tamanho ou alta resolução de câmeras mobile.
 */

export interface CompressImageOptions {
  maxSide?: number
  quality?: number
  mimeType?: string
}

/**
 * Redimensiona e comprime uma foto (File ou Blob) via Canvas HTML5.
 * - Limita o lado maior a maxSide (padrão: 1600px)
 * - Comprime em JPEG com qualidade configurável (padrão: 0.8)
 * - Retorna um File pronto para inclusão em FormData.
 */
export async function compressImageFile(
  file: File,
  options: CompressImageOptions = {},
): Promise<File> {
  const { maxSide = 1600, quality = 0.8, mimeType = 'image/jpeg' } = options

  // Se o arquivo já não for imagem, retorna sem alteração
  if (!file.type.startsWith('image/')) {
    return file
  }

  // Se for SVG, não redimensiona por canvas
  if (file.type === 'image/svg+xml') {
    return file
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Erro ao ler o arquivo de imagem.'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Erro ao decodificar a imagem.'))
      img.onload = () => {
        try {
          let { width, height } = img

          // Calcular proporção mantendo aspect ratio
          if (width > maxSide || height > maxSide) {
            if (width > height) {
              height = Math.round((height * maxSide) / width)
              width = maxSide
            } else {
              width = Math.round((width * maxSide) / height)
              height = maxSide
            }
          }

          const canvas = document.createElement('canvas')
          canvas.width = Math.max(1, width)
          canvas.height = Math.max(1, height)

          const ctx = canvas.getContext('2d')
          if (!ctx) {
            resolve(file)
            return
          }

          // Fundo branco se for JPEG para evitar transparência preta
          if (mimeType === 'image/jpeg') {
            ctx.fillStyle = '#FFFFFF'
            ctx.fillRect(0, 0, canvas.width, canvas.height)
          }

          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

          canvas.toBlob(
            (blob) => {
              if (!blob) {
                resolve(file)
                return
              }

              // Derivar nome de arquivo seguro com extensão .jpg
              let safeName = file.name.replace(/\.[^/.]+$/, '') + '.jpg'
              if (!safeName.endsWith('.jpg')) {
                safeName = `${safeName}.jpg`
              }

              const compressedFile = new File([blob], safeName, {
                type: mimeType,
                lastModified: Date.now(),
              })

              // Se a compressão gerou um arquivo maior que o original (muito raro), mantém original
              if (compressedFile.size > file.size && file.size < 5 * 1024 * 1024) {
                resolve(file)
              } else {
                resolve(compressedFile)
              }
            },
            mimeType,
            quality,
          )
        } catch (err) {
          console.warn('Falha durante compressão no canvas, usando arquivo original:', err)
          resolve(file)
        }
      }

      img.src = reader.result as string
    }

    reader.readAsDataURL(file)
  })
}

/**
 * Converte dataURL de assinatura em um arquivo otimizado (PNG ou JPEG)
 */
export async function dataUrlToFile(dataUrl: string, filename: string): Promise<File | null> {
  if (!dataUrl || !dataUrl.startsWith('data:image')) {
    return null
  }

  try {
    const res = await fetch(dataUrl)
    const blob = await res.blob()
    const mime = blob.type || 'image/png'
    return new File([blob], filename, { type: mime })
  } catch (e) {
    console.warn('Erro ao converter dataURL para File:', e)
    return null
  }
}
