const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'js', 'workflows', 'flow_assembly.js');
const lines = fs.readFileSync(filePath, 'utf8').split('\n');

console.log('Total lines before:', lines.length);

// Find the old placeStructureMarkers function start and end
let startLine = -1;
let endLine = -1;

for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('placeStructureMarkers: async function (hastaFase = 5)')) {
        startLine = i;
        console.log('Found start at line 0-indexed:', i, '| content:', lines[i].substring(0, 80));
    }
    if (startLine >= 0 && lines[i].includes('getUtils().handleError(e, "placeStructureMarkers");')) {
        // The function ends with }, after this catch block
        // lines[i] is the error line, lines[i+1] should be '},'
        endLine = i + 1; // the closing }, 
        console.log('Found end at line 0-indexed:', endLine, '| content:', lines[endLine].substring(0, 80));
        break;
    }
}

if (startLine < 0 || endLine < 0) {
    console.error('Could not find placeStructureMarkers boundaries!');
    process.exit(1);
}

// Also remove the comment block above it (lines with /** ... */)
let commentStart = startLine;
while (commentStart > 0) {
    const prevLine = lines[commentStart - 1].trim();
    if (prevLine === '') {
        // Check if the line above the blank is the closing } of previous function
        if (commentStart - 2 >= 0 && lines[commentStart - 2].trim() === '},') {
            break;
        }
        // If there's a blank line followed by a comment start, include the blank too
        commentStart--;
        break;
    }
    if (prevLine.startsWith('/**') || prevLine.startsWith(' *') || prevLine === ' */') {
        commentStart--;
    } else {
        break;
    }
}

console.log('Removing lines', commentStart, 'to', endLine, '(0-indexed)');
console.log('First removed line:', JSON.stringify(lines[commentStart]));
console.log('Last removed line:', JSON.stringify(lines[endLine]));

const newLines = [...lines.slice(0, commentStart), ...lines.slice(endLine + 1)];

fs.writeFileSync(filePath, newLines.join('\n'), 'utf8');
console.log('Total lines after:', newLines.length);
console.log('Done!');
