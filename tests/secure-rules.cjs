const assert=require('assert'),zlib=require('zlib');const {Chess}=require('chess.js');
(async()=>{
 const {adjudicate,validateDecodedPNG}=await import('../supabase/functions/bchess-secure/rules.mjs');
 function chunk(name,body){const n=Buffer.alloc(4);n.writeUInt32BE(body.length);const data=Buffer.concat([Buffer.from(name),body]);let crc=0xffffffff;for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const end=Buffer.alloc(4);end.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([n,data,end]);}
 function png(raw=Buffer.alloc(32*(32*4+1)),headerChange){const header=Buffer.alloc(13);header.writeUInt32BE(32,0);header.writeUInt32BE(32,4);header[8]=8;header[9]=6;headerChange?.(header);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
 assert.deepEqual(await validateDecodedPNG(png()),{width:32,height:32});
 await assert.rejects(validateDecodedPNG(Buffer.from('<svg onload="alert(1)"/>')));
 await assert.rejects(validateDecodedPNG(png(Buffer.alloc(4))));
 await assert.rejects(validateDecodedPNG(png(Buffer.alloc(100000))));
 await assert.rejects(validateDecodedPNG(png(undefined,h=>h.writeUInt32BE(64,4))));
 await assert.rejects(validateDecodedPNG(png(undefined,h=>h[12]=1)));
 const corrupt=png();corrupt[45]^=1;await assert.rejects(validateDecodedPNG(corrupt));
 await assert.rejects(validateDecodedPNG(Buffer.concat([png(),Buffer.from('payload')])));
 let c=new Chess();['f3','e5','g4'].forEach(m=>c.move(m));const game={status:'active',white_id:'w',black_id:'b',fen:c.fen(),moves:c.history()};
 assert.equal(adjudicate(Chess,game,'b',{from:'d8',to:'h4'}).terminal,'checkmate');
 assert.throws(()=>adjudicate(Chess,{...game,fen:new Chess().fen()},'b',{from:'d8',to:'h4'}));
 c=new Chess();['Nf3','Nf6','Ng1','Ng8','Nf3','Nf6','Ng1'].forEach(m=>c.move(m));
 assert.equal(adjudicate(Chess,{...game,fen:c.fen(),moves:c.history()},'b',{from:'f6',to:'g8'}).terminal,'draw');
 console.log('PASS secure pure rules: PNG decode, truncation/CRC/extra data/dimensions rejection; replayed checkmate, repetition draw and stored-position integrity.');
})().catch(e=>{console.error(e.message);process.exit(1)});
