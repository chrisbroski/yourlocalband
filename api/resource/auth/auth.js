const fs = require("fs").promises;
const main = require('../../inc/main.js');

const template = {};
const failedLogins = {};

process.env.FAIL_UNTIL_LOCKOUT = process.env.FAIL_UNTIL_LOCKOUT || 10;
process.env.LOCKOUT_DURATION_SECONDS = process.env.LOCKOUT_DURATION_SECONDS || 600000;
process.env.SESSION_TIMEOUT_SECONDS = process.env.SESSION_TIMEOUT_SECONDS || 31622400;

function single(db, id, req, msg, error) {
    var authUserData = main.getAuthUserData(req, db.user);

    var resourceData = Object.assign({
        "id": id,
        "resourceName": "user",
        "pageName": db.user[id].name,
        "adminChecked": !!db.user[id].admin ? ' checked="checked"' : '',
        "memberChecked": !!db.user[id].bandMember ? ' checked="checked"' : '',
        "isOwnUser": (authUserData.userid === id),
        "countries": main.country(db.user[id].country),
        "photos": main.displayPhotos(db.photo, db.user[id].photo),
        "no-photo": main.noPhotoSelected(db.user[id].photo)
    }, db.user[id]);

    return Object.assign(main.addMessages(msg, error), resourceData);
}

function cleanFailedLogins() {
    var now = (new Date()).getTime();

    Object.keys(failedLogins).forEach(function (login) {
        failedLogins[login] = failedLogins[login].filter(function (failedAt) {
            return (failedAt > now - process.env.LOCKOUT_DURATION_SECONDS);
        });
    });
}

function addFailedLogin(username) {
    if (!failedLogins[username]) {
        failedLogins[username] = [];
    }
    failedLogins[username].push((new Date()).getTime());
}

function isUserLockedOut(username) {
    cleanFailedLogins();
    if (!failedLogins[username]) {
        return false;
    }
    if (failedLogins[username].length >= process.env.FAIL_UNTIL_LOCKOUT) {
        return true;
    }
    return false;
}

function fail(req, rsp, msg, db, email) {
    var passwordAutofocus = "";
    var emailAutofocus = "";
    var secure = (process.env.DEV === "Y") ? "" : " Secure";
    if (email) {
        passwordAutofocus = ' autofocus="autofocus"';
    } else {
        email = "";
        emailAutofocus = ' autofocus="autofocus"';
    }

    rsp.setHeader('Set-Cookie', [
        `token=; Path=/; SameSite=Strict; HttpOnly;${secure}`,
        `user=; Path=/; SameSite=Strict; HttpOnly;${secure}`
    ]);

    if (req.headers.accept === 'application/json') {
        return main.returnJson(rsp, {"msg": msg}, 403);
    } else {
        rsp.writeHead(403, {'Content-Type': 'text/html'});
        rsp.end(main.renderPage(req, template.login, {"msg": msg, "email": email, "passwordAutofocus": passwordAutofocus, "emailAutofocus": emailAutofocus}, db));
    }
    return false;
}
this.fail = fail;

function updatePassword(id, formData, db, save) {
    var salt = main.makeId(12);
    var hash = main.hash(formData.passwordNew, salt);

    db.user[id].salt = salt;
    db.user[id].hash = hash;
    db.user[id].token = '';

    save();
}
this.updatePassword = updatePassword;

function isSetInvalid(req, formData, db, id) {
    var msg = [];

    if (!formData.passwordNew) {
        msg.push('New password is required.');
    }
    if (formData.passwordNew.length < 8) {
        msg.push('Password must be at least 8 characters.');
    }
    if (formData.passwordNew !== formData.passwordConfirm) {
        msg.push("Passwords don't match.");
    }
    if (formData.token !== db.user[id].token) {
        msg.push('Token invalid.');
    }
    if (main.getAuthUserData(req, db.user)) {
        msg.push("Cannot reset password when logged in. Please log out.");
    }

    return msg;
}

function isUpdateInvalid(formData, db, id) {
    var msg = [];

    if (!formData.passwordNew) {
        msg.push('New password is required.');
    }
    if (formData.passwordNew.length < 8) {
        msg.push('Password must be at least 8 characters.');
    }
    if (formData.passwordNew !== formData.passwordConfirm) {
        msg.push("Passwords don't match.");
    }
    if (db.user[id].hash !== main.hash(formData.password, db.user[id].salt)) {
        msg.push('Current password incorrect.');
    }

    return msg;
}

function setLoginCookie(rsp, userData, userId) {
    var token = main.hash(userData.password + userId, userData.salt);
    var secure = (process.env.DEV === "Y") ? "" : " Secure";

    rsp.setHeader('Set-Cookie', [
        `token=${token}; Path=/; SameSite=Strict; Max-Age=${process.env.SESSION_TIMEOUT_SECONDS}; HttpOnly;${secure}`,
        `user=${userId}; Path=/; SameSite=Strict; Max-Age=${process.env.SESSION_TIMEOUT_SECONDS}; HttpOnly;${secure}`
    ]);
}

function pathFromFullUrl(url) {
    var parsedUrl = {};
    parsedUrl.host = url.slice(url.indexOf("://") + 3, url.indexOf("/", 8));
    parsedUrl.path = url.slice(url.indexOf(parsedUrl.host) + parsedUrl.host.length);
    return parsedUrl;
}

function authenticate(req, rsp, db, path) {
    var cookies, userid;
    var userData;

    var exceptions = ["login", "password", "forgot-password", "start"];
    if (exceptions.indexOf(path.resource) > -1) {
        return true;
    }

    cookies = main.parseCookie(req.headers.cookie);
    if (!cookies.user) {
        return fail(req, rsp, 'Not logged in', db);
    }
    userid = cookies.user;

    userData = db.user[userid];
    if (!userData) {
        return fail(req, rsp, 'User id not found', db);
    }

    if (!userData.hash) {
        return fail(req, rsp, 'User not able to log in. Please contact your moderator.', db);
    }

    if (main.hash(userData.password + userid, userData.salt) !== cookies.token) {
        return fail(req, rsp, 'Invalid token', db);
    }

    return true;
}
this.authenticate = authenticate;

function login(req, rsp, body, db) {
    var lockoutDuration;
    var userId;
    var userData;

    var redirectUrl = `${process.env.SUBDIR}/site`;
    var refererPath = pathFromFullUrl(req.headers.referer);
    if (refererPath.host === req.headers.host && refererPath.path !== `${process.env.SUBDIR}/login`) {
        redirectUrl = refererPath.path;
    }

    if (!body.username) {
        return fail(req, rsp, `User email required.`, db);
    }

    if (!body.password) {
        return fail(req, rsp, `Password required.`, db, body.username);
    }

    userId = main.getUserIdByEmail(body.username, db.user);
    userData = db.user[userId];
    if (!userId) {
        addFailedLogin(userId);
        return fail(req, rsp, `Bad username and/or password`, db, body.username);
    }

    if (!userData.hash) {
        return fail(req, rsp, 'User not able to log in. Please contact your moderator.', db, body.username);
    }

    if (isUserLockedOut(userId)) {
        lockoutDuration = Math.round(process.env.LOCKOUT_DURATION_SECONDS / 60000);
        return fail(req, rsp, `User locked out from too many failed attempts.
        Try again in ${lockoutDuration} minutes.`, db, body.username);
    }

    if (userData.hash === main.hash(body.password, userData.salt)) {
        setLoginCookie(rsp, userData, userId);
        rsp.writeHead(303, {'Content-Type': 'text/html', "Location": redirectUrl});
        rsp.end(main.renderPage(req, null, {"msg": ["Logged in"], "title": `Logged in`, "link": `${process.env.SUBDIR}/`}, db));
        return true;
    }

    // Failed login
    addFailedLogin(userId);
    fail(req, rsp, 'Bad username and/or password', db, body.username);
    return false;
}
this.login = login;

function logout(req, rsp, db) {
    var secure = (process.env.DEV === "Y") ? "" : " Secure";
    rsp.setHeader('Set-Cookie', [
        `token=; Path=/; SameSite=Strict; HttpOnly;${secure}`, // make secure later
        `user=; Path=/; SameSite=Strict; HttpOnly;${secure}` // make secure later
    ]);
    rsp.writeHead(303, {'Content-Type': 'text/html', "Location": `${process.env.SUBDIR}/`});
    rsp.end(main.renderPage(req, null, {"msg": ["Logged out"], "title": `Logged out`, "link": `${process.env.SUBDIR}/`}, db));
}
this.logout = logout;

function set(req, rsp, id, formData, db, save) {
    var error = isSetInvalid(req, formData, db, id);
    if (error.length) {
        rsp.writeHead(400, {'Content-Type': 'text/html'});
        rsp.end(main.renderPage(req, template.password, Object.assign(main.addMessages("", error), {"token": formData.token, "email": formData.email, "id": id}), db));
        return;
    }

    updatePassword(id, formData, db, save);
    setLoginCookie(rsp, db.user[id], id);
    rsp.writeHead(303, {'Content-Type': 'text/html', "Location": `${process.env.SUBDIR}/`});
    rsp.end(main.renderPage(req, null, {"msg": ["Password set"], "title": `Password set`, "link": `${process.env.SUBDIR}/`}, db));
    return;
}
this.set = set;

function resetPassword(id, db, save) {
    db.user[id].salt = '';
    db.user[id].hash = '';
    db.user[id].token = main.makeId(6);
    save();
    return db.user[id].token;
}

this.reset = function(req, rsp, id, db, save) {
    if (!main.isMod(req, db)) {
        rsp.writeHead(403, {'Content-Type': 'text/plain'});
        rsp.end('Only moderators can reset passwords.');
        return;
    }

    var token = resetPassword(id, db, save);

    // make secure when it is secure
    var returnUrl = `http://${req.headers.host}${process.env.SUBDIR}/password/${id}?token=${token}`;
    // sendResetEmail(returnUrl, rsp, data.user[path.id].email, 'reset-password');
    rsp.writeHead(200, {'Content-Type': 'text/html'});//.end(`Complete reset at: ${returnUrl}`);
    rsp.end(main.renderPage(req, null, {"msg": ["Password reset"], "title": `Password Reset`, "link": returnUrl}, db));
    return;
};

this.update = function (req, rsp, id, formData, db, save) {
    if (!db.user[id]) {
        return main.notFound(rsp, req.url, 'PUT', req, db);
    }

    var error = isUpdateInvalid(formData, db, id);
    if (error.length) {
        rsp.writeHead(400, {'Content-Type': 'text/html'});
        rsp.end(main.renderPage(req, template.user, single(db, id, req, "", error), db));
        return;
    }

    // validate more fields
    updatePassword(id, formData, db, save);
    var returnData = main.responseData("", "", db, "Change Password", ["Password updated."]);
    setLoginCookie(rsp, db.user[id], id);

    if (req.headers.accept === 'application/json') {
        return main.returnJson(rsp, returnData);
    }

    returnData.back = req.headers.referer;
    rsp.writeHead(303, {'Content-Type': 'text/html', "Location": `${process.env.SUBDIR}/user/`});
    rsp.end(main.renderPage(req, null, returnData, db));
};

this.get = function (req, rsp, db) {
    if (req.headers.accept === 'application/json') {
        return main.returnJson(rsp, {});
    }

    // check if already logged in. If so, redirect to home. (With message?)
    if (main.isLoggedIn(req, db.user)) {
        rsp.writeHead(303, {'Content-Type': 'text/html', "Location": `${process.env.SUBDIR}/`});
        rsp.end(main.renderPage(req, null, {"msg": ["Already logged in"], "title": `Logged in`, "link": `${process.env.SUBDIR}/`}, db));
        return;
    }

    rsp.writeHead(200, {'Content-Type': 'text/html'});
    rsp.end(main.renderPage(req, template.login, {}, db));
};

this.getPassword = function (req, rsp, id, db) {
    var qs = main.parseQs(req.url, true);
    var pwData = {"id": id, "token": qs.token, "msg": []};

    if (!id || !db.user[id]) {
        return main.notFound(rsp, req.url, 'GET', req, db);
    }
    pwData.email = db.user[id].email;

    if (qs.token && id && db.user[id] && db.user[id].token === qs.token) {
        // fix this later
    } else {
        pwData.msg.push("Invalid token");
    }

    if (main.getAuthUserData(req, db.user).userid) {
        pwData.msg.push("Cannot reset password when logged in. Please log out.");
    }

    if (req.headers.accept === 'application/json') {
        return main.returnJson(rsp, pwData);
    }

    if (pwData.msg.length === 0) {
        rsp.writeHead(200, {'Content-Type': 'text/html'});
        rsp.end(main.renderPage(req, template.password, pwData, db));
    } else {
        rsp.writeHead(400, {'Content-Type': 'text/html'});
        rsp.end(main.renderPage(req, template.password, pwData, db));
    }
};

async function loadData() {
    template.login = await fs.readFile(`${__dirname}/login.html.mustache`, 'utf8');
    template.password = await fs.readFile(`${__dirname}/password.html.mustache`, 'utf8');
    template.forgotPassword = await fs.readFile(`${__dirname}/forgot-password.html.mustache`, 'utf8');
    template.user = await fs.readFile(`${__dirname}/../user/user.html.mustache`, 'utf8');
}

loadData();
