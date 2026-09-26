import {readFile,readdir} from 'node:fs/promises';
export function createDatabase(pool){
 const translate=sql=>{let index=0;return sql.replace(/strftime\('%Y-%m-%dT%H:%M:%fZ','now'\)/g,'CURRENT_TIMESTAMP').replace(/\?/g,()=>'$'+(++index));};
 const prepare=sql=>{const query=translate(sql);return {bind(...params){return statement(query,params);},...statement(query,[])};};
 const statement=(sql,params)=>({sql,params,async first(){return (await pool.query(sql,params)).rows[0]||null;},async all(){return (await pool.query(sql,params)).rows;},async run(){const result=await pool.query(sql,params);return {meta:{changes:result.rowCount}};}});
 return {prepare,async batch(statements){const client=await pool.connect();try{await client.query('BEGIN');for(const s of statements)await client.query(s.sql,s.params);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}};
}
export async function migrate(pool){const directory=new URL('../migrations/',import.meta.url);const files=(await readdir(directory)).filter(name=>name.endsWith('.sql')).sort();const client=await pool.connect();try{await client.query('BEGIN');for(const file of files)await client.query(await readFile(new URL(file,directory),'utf8'));await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
