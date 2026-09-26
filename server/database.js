import {readFile} from 'node:fs/promises';
export function createDatabase(pool){
 const translate=sql=>{let index=0;return sql.replace(/strftime\('%Y-%m-%dT%H:%M:%fZ','now'\)/g,'CURRENT_TIMESTAMP').replace(/\?/g,()=>'$'+(++index));};
 const prepare=sql=>{const query=translate(sql);return {bind(...params){return statement(query,params);},...statement(query,[])};};
 const statement=(sql,params)=>({sql,params,async first(){return (await pool.query(sql,params)).rows[0]||null;},async run(){const result=await pool.query(sql,params);return {meta:{changes:result.rowCount}};}});
 return {prepare,async batch(statements){const client=await pool.connect();try{await client.query('BEGIN');for(const s of statements)await client.query(s.sql,s.params);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}};
}
export async function migrate(pool){const sql=await readFile(new URL('../migrations/001_initial.sql',import.meta.url),'utf8');const client=await pool.connect();try{await client.query('BEGIN');await client.query(sql);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}
