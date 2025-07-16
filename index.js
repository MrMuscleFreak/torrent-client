'use strict';
const download = require('./src/downloads');
const torrentParser = require('./src/torrent-parser');

const torrent = torrentParser.open(process.argv[2]);

const infoHash = torrentParser.infoHash(torrent);
console.log('Info Hash:', infoHash.toString('hex'));

// Calculate the size for display purposes
const size = torrent.info.files
  ? torrent.info.files.map((file) => file.length).reduce((a, b) => a + b)
  : torrent.info.length;

const sizeInMB = (size / (1024 * 1024)).toFixed(2);
console.log(`Total Size: ${size} bytes (${sizeInMB} MB)`);

download(torrent);
