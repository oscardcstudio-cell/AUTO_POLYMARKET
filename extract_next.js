import fs from 'fs';
const html = fs.readFileSync('page_dump.html', 'utf8');
const buildIdMatch = html.match(/\"buildId\":\"([^\"]+)\"/);
const buildId = buildIdMatch ? buildIdMatch[1] : 'not found';
console.log('Build ID:', buildId);

const nextDataMatch = html.match(/<script id=\"__NEXT_DATA__\" type=\"application\/json\">([\s\S]*?)<\/script>/);
if (nextDataMatch) {
    console.log('NEXT_DATA found');
    fs.writeFileSync('next_data.json', nextDataMatch[1]);
} else {
    console.log('NEXT_DATA not found in script tag, searching in self.__next_f');
}
