'use strict';

const dgram = require('dgram');
const Buffer = require('buffer').Buffer;
const urlParse = require('url').parse;
const crypto = require('crypto');
const torrentParser = require('./torrent-parser');
const util = require('./utils');

module.exports.getPeers = (torrent, callback) => {
  const socket = dgram.createSocket('udp4');
  const announceList = torrent['announce-list'] || [[torrent.announce]];
  let receivedPeers = false;

  socket.on('error', (err) => {
    console.error('Socket error:', err.message);
    if (!receivedPeers) {
      tryNextTracker();
    }
  });

  // Function to send a message over UDP
  function udpSend(socket, message, rawUrl, cb = () => {}) {
    const url = urlParse(rawUrl);
    if (url.protocol === 'udp:') {
      socket.send(message, 0, message.length, url.port, url.hostname, cb);
    } else {
      cb(new Error('Tracker is not a UDP tracker.'));
    }
  }

  // Try trackers one by one
  let trackerIndex = 0;
  const tryNextTracker = () => {
    if (trackerIndex >= announceList.length || receivedPeers) {
      if (!receivedPeers) {
        console.log('Could not connect to any trackers.');
      }
      return socket.close();
    }

    const trackerGroup = announceList[trackerIndex];
    trackerIndex++;

    if (trackerGroup && trackerGroup[0]) {
      const url = trackerGroup[0].toString('utf8');
      console.log(`Attempting to connect to tracker: ${url}`);
      udpSend(socket, buildConnReq(), url, (err) => {
        if (err) {
          console.log(`Skipping non-UDP tracker: ${url}`);
          tryNextTracker();
        }
      });
    } else {
      tryNextTracker();
    }
  };

  socket.on('message', (response) => {
    if (respType(response) === 'connect') {
      console.log('Received connect response.');
      const connResp = parseConnResp(response);
      const announceReq = buildAnnounceReq(connResp.connectionId, torrent);
      const url = announceList[trackerIndex - 1][0].toString('utf8');
      udpSend(socket, announceReq, url);
    } else if (respType(response) === 'announce') {
      console.log('Received announce response.');
      const announceResp = parseAnnounceResp(response);

      // We got the peers, call the callback and set the flag to stop trying.
      receivedPeers = true;
      socket.close();
      callback(announceResp.peers);
    }
  });

  // Start the process
  tryNextTracker();
};

function respType(resp) {
  const action = resp.readUInt32BE(0);
  if (action === 0) return 'connect';
  if (action === 1) return 'announce';
}

function buildConnReq() {
  const buf = Buffer.alloc(16);
  // connection_id
  buf.writeUInt32BE(0x417, 0);
  buf.writeUInt32BE(0x27101980, 4);
  // action
  buf.writeUInt32BE(0, 8);
  // transaction_id
  crypto.randomBytes(4).copy(buf, 12);
  return buf;
}

function parseConnResp(resp) {
  return {
    action: resp.readUInt32BE(0),
    transactionId: resp.readUInt32BE(4),
    connectionId: resp.slice(8),
  };
}

function buildAnnounceReq(connId, torrent, port = 6881) {
  const buf = Buffer.allocUnsafe(98);
  // connection id
  connId.copy(buf, 0);
  // action
  buf.writeUInt32BE(1, 8);
  // transaction id
  crypto.randomBytes(4).copy(buf, 12);
  // info hash
  torrentParser.infoHash(torrent).copy(buf, 16);
  // peer id
  util.genId().copy(buf, 36);
  // downloaded
  Buffer.alloc(8).copy(buf, 56);
  // left
  torrentParser.size(torrent).copy(buf, 64);
  // uploaded
  Buffer.alloc(8).copy(buf, 72);
  // event
  buf.writeUInt32BE(0, 80);
  // ip address
  buf.writeUInt32BE(0, 84);
  // key
  crypto.randomBytes(4).copy(buf, 88);
  // num want
  buf.writeInt32BE(-1, 92);
  // port
  buf.writeUInt16BE(port, 96);
  return buf;
}

// Peer IP address parsing
function parseAnnounceResp(resp) {
  function group(iterable, groupSize) {
    let groups = [];
    for (let i = 0; i < iterable.length; i += groupSize) {
      groups.push(iterable.slice(i, i + groupSize));
    }
    return groups;
  }

  return {
    action: resp.readUInt32BE(0),
    transactionId: resp.readUInt32BE(4),
    leechers: resp.readUInt32BE(12),
    seeders: resp.readUInt32BE(16),
    peers: group(resp.slice(20), 6).map((address) => {
      return {
        // Parse the IP by reading each byte
        ip: `${address.readUInt8(0)}.${address.readUInt8(
          1
        )}.${address.readUInt8(2)}.${address.readUInt8(3)}`,
        port: address.readUInt16BE(4),
      };
    }),
  };
}
