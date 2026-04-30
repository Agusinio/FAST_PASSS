const fs = require('fs');
const path = require('path');

// Acepta el nombre del archivo como argumento CLI, o usa un default
const args = process.argv.slice(2);
const fileName = args[0] || 'TN_VESPRE_20260423_213005.json';
const filePath = path.join(__dirname, fileName);

try {
    console.log(`Leyendo ${filePath}...`);
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    const formatted = JSON.stringify(data, null, 2);
    fs.writeFileSync(filePath, formatted, 'utf8');
    console.log(`Archivo "${fileName}" formateado exitosamente con indentación de 2 espacios.`);
} catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
}