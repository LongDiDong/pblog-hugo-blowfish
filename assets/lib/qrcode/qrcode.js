/*! Compact QR (byte mode) for article share. Public-domain algorithm lineage (Nayuki-style). */
(function (global) {
  "use strict";

  var ECC_CODEWORDS_PER_BLOCK = [
    // L, M, Q, H for versions 1-40 — only M used; table trimmed via getEcc.
  ];

  // ECC codewords per block for ECC level M (index 1), versions 1..40
  var ECC_M = [-1,10,16,26,18,24,18,16,22,22,30,20,24,26,30,22,24,28,30,28,28,28,28,30,30,26,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30];
  var NUM_BLOCKS_M = [-1,1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49];

  function ReedSolomonGenerator(degree) {
    this.coefficients = [];
    for (var i = 0; i < degree - 1; i++) this.coefficients.push(0);
    this.coefficients.push(1);
    var root = 1;
    for (var i = 0; i < degree; i++) {
      for (var j = 0; j < this.coefficients.length; j++) {
        this.coefficients[j] = this.multiply(this.coefficients[j], root);
        if (j + 1 < this.coefficients.length)
          this.coefficients[j] ^= this.coefficients[j + 1];
      }
      root = this.multiply(root, 0x02);
    }
  }
  ReedSolomonGenerator.prototype.multiply = function (x, y) {
    if (x === 0 || y === 0) return 0;
    return exp[(log[x] + log[y]) % 255];
  };
  ReedSolomonGenerator.prototype.getRemainder = function (data) {
    var result = [];
    for (var i = 0; i < this.coefficients.length; i++) result.push(0);
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ result.shift();
      result.push(0);
      for (var j = 0; j < this.coefficients.length; j++)
        result[j] ^= this.multiply(this.coefficients[j], factor);
    }
    return result;
  };

  var exp = new Array(256);
  var log = new Array(256);
  (function initGF() {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      exp[i] = x;
      log[x] = i;
      x <<= 1;
      if (x >= 256) x ^= 0x11d;
    }
    exp[255] = exp[0];
  })();

  function getNumRawDataModules(ver) {
    var result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }

  function getNumDataCodewords(ver) {
    return Math.floor(getNumRawDataModules(ver) / 8) -
      ECC_M[ver] * NUM_BLOCKS_M[ver];
  }

  function FinderPattern() {}
  function addFinder(modules, ox, oy, size) {
    for (var dy = -1; dy <= 7; dy++) {
      for (var dx = -1; dx <= 7; dx++) {
        var x = ox + dx, y = oy + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        var dist = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
        modules[y][x] = dist !== 2 && dist !== 4;
      }
    }
  }

  function addAlignment(modules, ox, oy, size) {
    for (var dy = -2; dy <= 2; dy++) {
      for (var dx = -2; dx <= 2; dx++) {
        var x = ox + dx, y = oy + dy;
        if (x < 0 || x >= size || y < 0 || y >= size) continue;
        var dist = Math.max(Math.abs(dx), Math.abs(dy));
        modules[y][x] = dist !== 1;
      }
    }
  }

  function getAlignmentPatternPositions(ver) {
    if (ver === 1) return [];
    var numAlign = Math.floor(ver / 7) + 2;
    var step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
    var result = [6];
    for (var pos = ver * 4 + 10 - step * (numAlign - 2); result.length < numAlign; pos -= step)
      result.splice(1, 0, pos);
    return result;
  }

  function drawFormatBits(modules, mask, size) {
    var data = (0x00 << 3) | mask; // ECC level M = 00
    var rem = data;
    for (var i = 0; i < 10; i++)
      rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = ((data << 10) | rem) ^ 0x5412;
    function set(x, y, v) { modules[y][x] = v; }
    for (var i = 0; i <= 5; i++) set(8, i, getBit(bits, i));
    set(8, 7, getBit(bits, 6));
    set(8, 8, getBit(bits, 7));
    set(7, 8, getBit(bits, 8));
    for (var i = 9; i < 15; i++) set(14 - i, 8, getBit(bits, i));
    for (var i = 0; i < 8; i++) set(size - 1 - i, 8, getBit(bits, i));
    for (var i = 8; i < 15; i++) set(8, size - 15 + i, getBit(bits, i));
    set(8, size - 8, true);
  }

  function drawVersion(modules, ver, size) {
    if (ver < 7) return;
    var rem = ver;
    for (var i = 0; i < 12; i++)
      rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    var bits = (ver << 12) | rem;
    for (var i = 0; i < 18; i++) {
      var a = Math.floor(i / 3), b = size - 11 + (i % 3);
      var bit = getBit(bits, i);
      modules[b][a] = bit;
      modules[a][b] = bit;
    }
  }

  function getBit(x, i) { return ((x >>> i) & 1) !== 0; }

  function applyMask(modules, isFunction, mask, size) {
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        if (isFunction[y][x]) continue;
        var invert = false;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = x * y % 2 + x * y % 3 === 0; break;
          case 6: invert = (x * y % 2 + x * y % 3) % 2 === 0; break;
          case 7: invert = ((x + y) % 2 + x * y % 3) % 2 === 0; break;
        }
        modules[y][x] ^= invert;
      }
    }
  }

  function getPenaltyScore(modules, size) {
    var result = 0;
    for (var y = 0; y < size; y++) {
      var runColor = false, runX = 0;
      var history = [0,0,0,0,0,0,0];
      for (var x = 0; x < size; x++) {
        if (x === 0 || modules[y][x] !== runColor) {
          history = [runX].concat(history.slice(0, 6));
          if (runColor && runX >= 5) result += runX - 2;
          runColor = modules[y][x];
          runX = 1;
        } else runX++;
      }
      if (runColor && runX >= 5) result += runX - 2;
    }
    for (var x = 0; x < size; x++) {
      var runColor = false, runY = 0;
      for (var y = 0; y < size; y++) {
        if (y === 0 || modules[y][x] !== runColor) {
          if (runColor && runY >= 5) result += runY - 2;
          runColor = modules[y][x];
          runY = 1;
        } else runY++;
      }
      if (runColor && runY >= 5) result += runY - 2;
    }
    for (var y = 0; y < size - 1; y++) {
      for (var x = 0; x < size - 1; x++) {
        var color = modules[y][x];
        if (color === modules[y][x + 1] && color === modules[y + 1][x] && color === modules[y + 1][x + 1])
          result += 3;
      }
    }
    var black = 0;
    for (var y = 0; y < size; y++)
      for (var x = 0; x < size; x++)
        if (modules[y][x]) black++;
    var k = Math.abs(black * 20 - size * size * 10) / (size * size);
    result += Math.floor(k) * 10;
    return result;
  }

  function encodeSegments(data) {
    var bytes = [];
    for (var i = 0; i < data.length; i++) {
      var c = data.charCodeAt(i);
      if (c < 128) bytes.push(c);
      else if (c < 2048) {
        bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else if (c < 0x10000) {
        bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      } else {
        bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }
    return bytes;
  }

  function appendBits(val, len, bb) {
    if (len < 0 || len > 31 || val >>> len !== 0) throw new Error("bits");
    for (var i = len - 1; i >= 0; i--)
      bb.push((val >>> i) & 1);
  }

  function getCharCountBits(ver) {
    return ver <= 9 ? 8 : ver <= 26 ? 16 : 16;
  }

  function makeModules(text) {
    var dataBytes = encodeSegments(text);
    var ver, dataUsedBits;
    for (ver = 1; ver <= 40; ver++) {
      var capacity = getNumDataCodewords(ver) * 8;
      var ccbits = getCharCountBits(ver);
      dataUsedBits = 4 + ccbits + dataBytes.length * 8;
      if (dataUsedBits <= capacity) break;
    }
    if (ver > 40) throw new Error("QR data too long");

    var bb = [];
    appendBits(0x4, 4, bb); // byte mode
    appendBits(dataBytes.length, getCharCountBits(ver), bb);
    for (var i = 0; i < dataBytes.length; i++) appendBits(dataBytes[i], 8, bb);
    var capacity = getNumDataCodewords(ver) * 8;
    appendBits(0, Math.min(4, capacity - bb.length), bb);
    appendBits(0, (8 - bb.length % 8) % 8, bb);
    for (var pad = 0xEC; bb.length < capacity; pad ^= 0xEC ^ 0x11)
      appendBits(pad, 8, bb);

    var dataCodewords = [];
    for (var i = 0; i < bb.length; i += 8) {
      var b = 0;
      for (var j = 0; j < 8; j++) b = (b << 1) | bb[i + j];
      dataCodewords.push(b);
    }

    var numBlocks = NUM_BLOCKS_M[ver];
    var blockEccLen = ECC_M[ver];
    var rawCodewords = Math.floor(getNumRawDataModules(ver) / 8);
    var numShortBlocks = numBlocks - (rawCodewords % numBlocks);
    var shortBlockLen = Math.floor(rawCodewords / numBlocks);

    var blocks = [];
    var rs = new ReedSolomonGenerator(blockEccLen);
    var k = 0;
    for (var i = 0; i < numBlocks; i++) {
      var dat = dataCodewords.slice(k, k + shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1));
      k += dat.length;
      var ecc = rs.getRemainder(dat);
      if (i < numShortBlocks) dat.push(0);
      blocks.push(dat.concat(ecc));
    }

    var result = [];
    for (var i = 0; i < blocks[0].length; i++) {
      for (var j = 0; j < blocks.length; j++) {
        if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks)
          result.push(blocks[j][i]);
      }
    }

    var size = ver * 4 + 17;
    var modules = [];
    var isFunction = [];
    for (var y = 0; y < size; y++) {
      modules.push(new Array(size).fill(false));
      isFunction.push(new Array(size).fill(false));
    }

    function markFunc(x, y) { isFunction[y][x] = true; }

    addFinder(modules, 0, 0, size);
    addFinder(modules, size - 7, 0, size);
    addFinder(modules, 0, size - 7, size);
    for (var dy = -1; dy <= 7; dy++) {
      for (var dx = -1; dx <= 7; dx++) {
        var coords = [[dx, dy], [size - 7 + dx, dy], [dx, size - 7 + dy]];
        for (var c = 0; c < 3; c++) {
          var x = coords[c][0], y = coords[c][1];
          if (x >= 0 && x < size && y >= 0 && y < size) markFunc(x, y);
        }
      }
    }

    var alignPos = getAlignmentPatternPositions(ver);
    for (var i = 0; i < alignPos.length; i++) {
      for (var j = 0; j < alignPos.length; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === alignPos.length - 1) || (i === alignPos.length - 1 && j === 0))
          continue;
        addAlignment(modules, alignPos[i], alignPos[j], size);
        for (var dy = -2; dy <= 2; dy++)
          for (var dx = -2; dx <= 2; dx++)
            markFunc(alignPos[i] + dx, alignPos[j] + dy);
      }
    }

    for (var i = 0; i < size; i++) {
      // Do not overwrite finder/separator modules already marked as function.
      // markFunc(x, y) indexes isFunction[y][x].
      if (!isFunction[6][i]) {
        modules[6][i] = i % 2 === 0;
        markFunc(i, 6);
      }
      if (!isFunction[i][6]) {
        modules[i][6] = i % 2 === 0;
        markFunc(6, i);
      }
    }

    drawFormatBits(modules, 0, size); // placeholder, mask applied later
    for (var i = 0; i < 15; i++) {
      // mark format regions as function after final draw; do provisional:
    }
    // Format + timing already; mark format areas:
    var formatCoords = [];
    for (var i = 0; i <= 8; i++) {
      if (i !== 6) { markFunc(8, i); markFunc(i, 8); }
    }
    for (var i = 0; i < 8; i++) { markFunc(size - 1 - i, 8); markFunc(8, size - 1 - i); }
    markFunc(8, size - 8);
    drawVersion(modules, ver, size);
    if (ver >= 7) {
      for (var i = 0; i < 18; i++) {
        var a = Math.floor(i / 3), b = size - 11 + (i % 3);
        markFunc(a, b); markFunc(b, a);
      }
    }

    // Draw codewords
    var allBits = [];
    for (var i = 0; i < result.length; i++)
      for (var j = 7; j >= 0; j--) allBits.push((result[i] >>> j) & 1);

    var bitIndex = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? size - 1 - vert : vert;
          if (!isFunction[y][x] && bitIndex < allBits.length) {
            modules[y][x] = allBits[bitIndex] === 1;
            bitIndex++;
          }
        }
      }
    }

    // Choose mask
    var minPenalty = Infinity;
    var bestMask = 0;
    var modulesCopy = modules.map(function (row) { return row.slice(); });
    for (var mask = 0; mask < 8; mask++) {
      for (var y = 0; y < size; y++)
        for (var x = 0; x < size; x++)
          modules[y][x] = modulesCopy[y][x];
      drawFormatBits(modules, mask, size);
      applyMask(modules, isFunction, mask, size);
      var penalty = getPenaltyScore(modules, size);
      if (penalty < minPenalty) {
        minPenalty = penalty;
        bestMask = mask;
      }
    }
    for (var y = 0; y < size; y++)
      for (var x = 0; x < size; x++)
        modules[y][x] = modulesCopy[y][x];
    drawFormatBits(modules, bestMask, size);
    applyMask(modules, isFunction, bestMask, size);
    return modules;
  }

  function draw(canvas, text, opts) {
    opts = opts || {};
    var modules = makeModules(String(text || ""));
    var size = modules.length;
    var scale = opts.scale || 4;
    var margin = opts.margin != null ? opts.margin : 2;
    var dark = opts.dark || "#000000";
    var light = opts.light || "#ffffff";
    var dim = (size + margin * 2) * scale;
    canvas.width = dim;
    canvas.height = dim;
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = dark;
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) {
        if (modules[y][x])
          ctx.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
      }
    }
    return canvas;
  }

  global.ArticleQR = { draw: draw };
})(typeof window !== "undefined" ? window : this);
