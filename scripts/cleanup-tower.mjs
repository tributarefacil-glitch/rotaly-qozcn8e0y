import fs from 'node:fs'

const filePath = 'src/components/ControlTower.tsx'
const content = fs.readFileSync(filePath, 'utf8')

// We want to find the first occurrence of:
// `      {/* 5, 6 & 7. MODALS:`
// down to `      />\n    </div>\n  )\n}`
// and remove everything between `      />\n    </div>\n  )\n}` and the final:
// `export const ControlTower: React.FC<ControlTowerProps> = (props) => {`

const modalsTag = '      {/* 5, 6 & 7. MODALS:'
const modalsIndex = content.indexOf(modalsTag)
if (modalsIndex === -1) {
  console.error('Could not find modalsTag')
  process.exit(1)
}

const endOfInner = content.indexOf('    </div>\n  )\n}', modalsIndex)
if (endOfInner === -1) {
  console.error('Could not find endOfInner')
  process.exit(1)
}

const finalExport = 'export const ControlTower: React.FC<ControlTowerProps> = (props) => {'
const finalExportIndex = content.lastIndexOf(finalExport)
if (finalExportIndex === -1) {
  console.error('Could not find finalExport')
  process.exit(1)
}

const cutStart = endOfInner + '    </div>\n  )\n}'.length
const newContent = content.slice(0, cutStart) + '\n\n' + content.slice(finalExportIndex)

fs.writeFileSync(filePath, newContent, 'utf8')
console.log(
  'Successfully trimmed leftover modal JSX! Old length:',
  content.length,
  'New length:',
  newContent.length,
)
