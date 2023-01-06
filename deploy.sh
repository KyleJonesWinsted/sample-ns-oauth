DESTINATION=/var/www/kylejones/html/netsuite-oauth
SERVER=kylejones@198.58.103.216

scp index.html $SERVER:$DESTINATION/index.html
scp style.css $SERVER:$DESTINATION/style.css
scp script.js $SERVER:$DESTINATION/script.js
