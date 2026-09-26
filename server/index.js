import pg from 'pg';
import {createDatabase,migrate} from './database.js';
import {createApp} from './app.js';
if(!process.env.DATABASE_URL||!process.env.ADMIN_PASSWORD){console.error('Set DATABASE_URL and ADMIN_PASSWORD before starting.');process.exit(1);}
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:5,connectionTimeoutMillis:10000,idleTimeoutMillis:30000});
pool.on('error',()=>console.error('Database connection temporarily unavailable.'));
try{await migrate(pool);}catch{console.error('Database initialization failed. Check DATABASE_URL, TLS settings and database permissions.');await pool.end();process.exit(1);}
const server=createApp({db:createDatabase(pool),password:process.env.ADMIN_PASSWORD,publicOrigin:process.env.PUBLIC_ORIGIN||process.env.RENDER_EXTERNAL_URL});
server.listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('Word Island server ready.'));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{server.close(async()=>{await pool.end();process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();});
