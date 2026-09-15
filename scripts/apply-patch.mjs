import fs from 'node:fs'
import path from 'node:path'

const filePath = path.resolve('src/components/ControlTower.tsx')
const content = fs.readFileSync(filePath, 'utf-8')

const target = `          if (hasForward) {
            lines.main?.setMap(map)
            lines.main.setPath(rawFPath)
            lines.inner?.setMap(map)
            lines.inner.setPath(rawFPath)
            fPoints.forEach((p: any) => bounds.extend(p))
            hasCoords = true
          } else {`

const replacement = `          if (hasForward) {
            if (!lines.main || !lines.inner) {
              // Rota nasceu só com perna de retorno; criar as linhas principais agora
              if (lines.main) lines.main.setMap(null)
              if (lines.inner) lines.inner.setMap(null)
              lines.main = new win.google.maps.Polyline({
                path: rawFPath,
                geodesic: true,
                strokeColor: '#2563EB',
                strokeOpacity: 0.95,
                strokeWeight: 5,
                map,
              })
              lines.inner = new win.google.maps.Polyline({
                path: rawFPath,
                geodesic: true,
                strokeColor: '#93C5FD',
                strokeOpacity: 0.85,
                strokeWeight: 2,
                map,
              })
            } else {
              lines.main.setMap(map)
              lines.main.setPath(rawFPath)
              lines.inner.setMap(map)
              lines.inner.setPath(rawFPath)
            }
            fPoints.forEach((p: any) => bounds.extend(p))
            hasCoords = true
          } else {`

if (!content.includes(target)) {
  console.error('Target block not found!')
  process.exit(1)
}

const newContent = content.replace(target, replacement)
fs.writeFileSync(filePath, newContent, 'utf-8')
console.log('Successfully replaced target block in ControlTower.tsx!')
