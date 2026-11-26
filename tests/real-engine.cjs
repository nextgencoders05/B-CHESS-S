// Exercise the badge worker protocol using the bundled Stockfish 18 CLI build.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const fs = require('node:fs');
const path = require('node:path');
const { fixture } = require('./interactions.cjs');

(async () => {
  const t = await fixture();
  const children = [];
  try {
    t.w.eval(fs.readFileSync(path.resolve(__dirname, '../engine-loader.js'), 'utf8'));
    t.w.Worker = class {
      constructor(url) {
        assert.equal(url.pathname, '/engine/stockfish-18-lite-single.js');
        this.process = spawn(process.execPath, [path.resolve(__dirname, '..' + url.pathname)]);
        children.push(this.process);
        readline.createInterface({input:this.process.stdout}).on('line',data=>this.onmessage?.({data}));
        this.process.on('error',error=>this.onerror?.(error));
      }
      postMessage(command) { this.process.stdin.write(command + '\n'); }
      terminate() { this.process.kill(); }
    };
    const chess = new t.w.Chess();
    const before = chess.fen();
    const move = chess.move('e4');
    const after = chess.fen();
    t.w.eval('game.load(' + JSON.stringify(after) + '); board.position(game.fen(), false);');
    let result;
    t.w.BChessBadges.inspect('myBoard',before,move,after,()=>true,value=>{result=value;});
    for(let i=0; i<120 && !result; i++) await new Promise(resolve=>setTimeout(resolve,100));
    assert(Number.isFinite(result?.loss),t.w.document.querySelector('#myBoardQuality')?.textContent);
    assert(t.w.document.querySelector('#myBoard [data-square="e4"] .quality-3d'));
    console.log('PASS bundled Stockfish 18 handshake, before/after analysis and move badge.');
  } finally {
    children.forEach(child=>child.kill());
    t.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
