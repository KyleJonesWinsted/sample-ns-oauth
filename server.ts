import express from 'express';
import fetch from 'node-fetch';

const app = express();

const CLIENT_ID = process.env.NS_CLIENT!;
const CLIENT_SECRET = process.env.NS_SECRET!;
const SCOPE = process.env.NS_SCOPE!;
const ACCOUNT = process.env.NS_ACCOUNT!;
const REDIRECT_URI = 'https://kylejon.es/netsuite-oauth/'; // Your URL here

app.use((req) => {
    console.log('request from', req.url);
    req.next?.();
});

app.get('/', (req, res) => {
    console.log(req.params);
    const authCode = req.query.code as string;
    const refreshToken = req.query.refresh as string;
    if (authCode) {
        return handleTokenRequest(authCode, 'code', res);
    }
    if (refreshToken) {
        return handleTokenRequest(refreshToken, 'refresh_token', res);
    }
    const authCodeUrl = createAuthCodeUrl();
    res.redirect(authCodeUrl);
});

app.listen(3000, () => {
    console.log('listening on port 3000');
});

function createAuthCodeUrl(): string {
    const baseUrl = `https://${ACCOUNT}.app.netsuite.com/app/login/oauth2/authorize.nl`;
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        scope: SCOPE,
        state: generateUUID(),
    });
    return baseUrl + '?' + params.toString();
}

function handleTokenRequest(grant: string, grantType: 'code' | 'refresh_token', res: express.Response): void {
    res.send(grantType + ' ' + grant);
}

function generateUUID(): string {
    let d = new Date().getTime();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        let r = Math.random() * 16;
        r = (d + r) % 16 | 0;
        d = Math.floor(d / 16);
        return (c == 'x' ? r : (r & 0x7 | 0x8)).toString(16);
    });
}

type Params = {
    code?: string;
}
