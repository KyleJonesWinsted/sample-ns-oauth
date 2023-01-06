"use strict";
var IDs = {
    dataDiv: "data",
    authCode: "auth-code",
    accessToken: "access-token",
    refreshToken: "refresh-token",
};
var Inputs = {
    clientId: "client-id",
    clientSecret: "client-secret",
    scope: "scope",
};
var Buttons = {
    auth: document.getElementById("auth-button"),
    token: document.getElementById("token-button"),
    refresh: document.getElementById("refresh-button")
};
document.addEventListener('DOMContentLoaded', function () {
    var code = new URLSearchParams(document.location.search).get('code');
    if (!code)
        return;
    document.getElementById(IDs.authCode).innerHTML = code;
});
var _loop_1 = function (id) {
    var input = document.getElementById(id);
    setStoredValue(id, input);
    input.addEventListener('keyup', function () {
        var value = input.value;
        handleParamChange(id, value);
    });
};
for (var _i = 0, _a = Object.values(Inputs); _i < _a.length; _i++) {
    var id = _a[_i];
    _loop_1(id);
}
function setStoredValue(id, input) {
    var value = localStorage.getItem(id);
    if (!value)
        return;
    input.value = value;
}
function handleParamChange(id, value) {
    localStorage.setItem(id, value);
}
Buttons.auth.addEventListener('click', function () {
});
Buttons.token.addEventListener('click', function () {
});
Buttons.refresh.addEventListener('click', function () {
});
