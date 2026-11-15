// Shared pure checks: tested in Node; used by the Edge Function.
export function adjudicate(Chess, stored, uid, input) {
  if (stored.status !== 'active') throw new Error('Match is not active');
  const chess = new Chess();
  for (const move of stored.moves) chess.move(move);
  if (chess.fen() !== stored.fen) throw new Error('Stored position mismatch');
  if (uid !== (chess.turn() === 'w' ? stored.white_id : stored.black_id)) throw new Error('Not your turn');
  if (!input || !/^[a-h][1-8]$/.test(input.from) || !/^[a-h][1-8]$/.test(input.to) || (input.promotion && !/^[qrbn]$/.test(input.promotion))) throw new Error('Invalid move');
  const m = chess.move({from:input.from,to:input.to,promotion:input.promotion || 'q'});
  if (!m) throw new Error('Illegal move');
  return {move:m.san,fen:chess.fen(),terminal:chess.isCheckmate()?'checkmate':chess.isDraw()?'draw':null};
}
export function validatePNG(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length<45 || bytes.length>524288) throw new Error('PNG must be at most 512 KB');
  const signature=[137,80,78,71,13,10,26,10];if(!signature.every((v,i)=>bytes[i]===v))throw new Error('Only actual PNG files are accepted');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let at=8,width=0,height=0,idat=false,ended=false;
  while(at<bytes.length){if(at+12>bytes.length)throw new Error('Truncated PNG');const length=view.getUint32(at),type=String.fromCharCode(...bytes.slice(at+4,at+8));if(at+length+12>bytes.length)throw new Error('Invalid PNG chunk');
    // CRC protects against malformed chunks; reject non-image payload chunks.
    let crc=0xffffffff;for(let j=at+4;j<at+8+length;j++){crc^=bytes[j];for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    if(((crc^0xffffffff)>>>0)!==view.getUint32(at+8+length))throw new Error('Invalid PNG checksum');
    if(at===8&&type!=='IHDR')throw new Error('Missing PNG header');
    if(type==='IHDR'){if(width||length!==13)throw new Error('Invalid PNG header');width=view.getUint32(at+8);height=view.getUint32(at+12);if(width!==height||width<32||width>1024)throw new Error('Use square PNGs, 32–1024 pixels');}
    else if(type==='IDAT')idat=true;
    else if(type==='IEND'){if(length!==0||at+12!==bytes.length)throw new Error('Invalid PNG ending');ended=true;}
    else if(!['PLTE','tRNS','sRGB','gAMA','cHRM','pHYs'].includes(type))throw new Error('Unsupported PNG metadata. Upload the image through the app to normalize it.');
    at+=length+12;
  }
  if(!ended||!idat)throw new Error('Incomplete PNG');return {width,height};
}

// Browser canvas normalizes uploads to 8-bit, non-interlaced RGB/RGBA PNGs.
// Verify the compressed pixels too, not merely the signature and chunk CRCs.
export async function validateDecodedPNG(bytes) {
  const dimensions=validatePNG(bytes),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(bytes[24]!==8||![2,6].includes(bytes[25])||bytes[26]!==0||bytes[27]!==0||bytes[28]!==0)throw new Error('Upload through the app to normalize PNG encoding');
  const chunks=[];for(let at=8;at<bytes.length;){const n=view.getUint32(at);if(String.fromCharCode(...bytes.slice(at+4,at+8))==='IDAT')chunks.push(bytes.slice(at+8,at+8+n));at+=n+12;}
  const stride=dimensions.width*(bytes[25]===6?4:3)+1,expected=stride*dimensions.height;
  const reader=new Blob(chunks).stream().pipeThrough(new DecompressionStream('deflate')).getReader();let count=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;if(count+value.length>expected)throw new Error('Invalid PNG pixel data');for(let i=0;i<value.length;i++)if((count+i)%stride===0&&value[i]>4)throw new Error('Invalid PNG scanline');count+=value.length;}}finally{await reader.cancel();}
  if(count!==expected)throw new Error('Incomplete PNG pixel data');return dimensions;
}
