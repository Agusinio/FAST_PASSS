const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'TN_VESPRE_20260423_213005.json');

try {
    console.log(`Leyendo ${filePath}...`);
    const raw = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(raw);
    const formatted = JSON.stringify(data, null, 2);
    fs.writeFileSync(filePath, formatted, 'utf8');
    console.log('Archivo formateado exitosamente con indentación de 2 espacios.');
} catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
}