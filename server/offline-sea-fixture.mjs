export function installSeaMiles(sql,migration,user){
 for(const name of ['20260910200000_ADD_SEA_MILES.sql','20260911120000_ADD_CAPTAIN_SEA_MILE_CONTACTS.sql','20260911140000_ADD_SEA_MILE_FOLDERS.sql'])sql(migration(name));
 sql(`INSERT INTO captain_sea_mile_contacts(user_id,first_name,last_name,email_address) VALUES('${user}','Synthetic','Captain','captain@example.test');`);
 sql(migration('20261110160000_web_offline_sea_miles.sql'));
}
