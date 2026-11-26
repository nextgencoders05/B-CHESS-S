async function openStockfish18() {
  const worker = new Worker(new URL('engine/stockfish-18-lite-single.js', document.baseURI));
  try {
    await new Promise((resolve, reject) => {
      let identified = false;
      const timeout = setTimeout(() => finish(new Error('Stockfish 18 startup timed out')), 30000);
      function finish(error) {
        clearTimeout(timeout);
        worker.onmessage = worker.onerror = null;
        if (error) reject(error);
        else resolve();
      }
      worker.onerror = () => finish(new Error('Could not load Stockfish 18'));
      worker.onmessage = ({data}) => {
        if (/^id name Stockfish 18\b/.test(data)) identified = true;
        if (data === 'uciok') finish(identified ? null : new Error('Unexpected engine version'));
      };
      worker.postMessage('uci');
    });
    return worker;
  } catch (error) {
    worker.terminate();
    throw error;
  }
}
