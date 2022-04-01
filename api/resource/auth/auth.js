const main = require('../../inc/main.js');
var url = require('url');

const template = {};
const failedLogins = {};
var LOGIN_FAIL_UNTIL_LOCKOUT;
var LOCKOUT_DURATION_SECONDS;
var SESSION_TIMEOUT_SECONDS;

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
        "photos": main.displayPhotos(db.photos, db.user[id].photo),
        "no-photo": main.noPhotoSelected(db.user[id].photo)
    }, db.user[id]);

    return Object.assign(main.addMessages(msg, error), resourceData);
}

function cleanFailedLogins() {
    var now = (new Date()).getTime();

    Object.keys(failedLogins).forEach(function (login) {
        failedLogins[login] = failedLogins[login].filter(function (failedAt) {
            return (failedAt > now - LOCKOUT_DURATION_SECONDS);
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
    if (failedLogins[username].length >= LOGIN_FAIL_UNTIL_LOCKOUT) {
        return true;
    }
    return false;
}

function fail(req, rsp, msg, db, API_DIR, email) {
    var passwordAutofocus = "";
    var emailAutofocus = "";
    if (email) {
        passwordAutofocus = ' autofocus="autofocus"';
    } else {
        email = "";
        emailAutofocus = ' autofocus="autofocus"';
    }

    rsp.setHeader('Set-Cookie', [
        `token=; Path=/; SameSite=Strict; Secure`,
        `user=; Path=/; SameSite=Strict; Secure`
    ]);

    if (req.headers.accept === 'application/json') {
        return main.returnJson(rsp, {"msg": msg}, 403);
    } else {
        rsp.writeHead(403, {'Content-Type': 'text/html'});
        rsp.end(main.renderPage(req, template.login, {"msg": msg, "email": email, "passwordAutofocus": passwordAutofocus, "emailAutofocus": emailAutofocus}, db, API_DIR));
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

function login(req, rsp, body, db, API_DIR) {
    var lockoutDuration;
    var userId;
    var token;
    var userData;
    var secure = " Secure";
    secure = ""; // at least until I get https on everything

    if (!body.email) {
        return fail(req, rsp, `User email required.`, db, API_DIR);
    }

    if (!body.password) {
        return fail(req, rsp, `Password required.`, db, API_DIR, body.email);
    }

    userId = main.getUserIdByEmail(body.email, db.user);
    userData = db.user[userId];
    if (!userId) {
        addFailedLogin(userId);
        return fail(req, rsp, `Bad username and/or password`, db, API_DIR, body.email);
    }

    if (!userData.hash) {
        return fail(req, rsp, 'User not able to log in. Please contact your moderator.', db, API_DIR, body.email);
    }

    if (isUserLockedOut(userId)) {
        lockoutDuration = Math.round(LOCKOUT_DURATION_SECONDS / 60000);
        return fail(req, rsp, `User locked out from too many failed attempts.
        Try again in ${lockoutDuration} minutes.`, db, API_DIR, body.email);
    }

    if (userData.hash === main.hash(body.password, userData.salt)) {
        if (process.env.QA) {
            secure = "";
        }
        token = main.hash(userData.password + userId, userData.salt);

        rsp.setHeader('Set-Cookie', [
            `token=${token}; Path=/; SameSite=Strict; Max-Age=${SESSION_TIMEOUT_SECONDS};${secure}`,
            `user=${userId}; Path=/; SameSite=Strict; Max-Age=${SESSION_TIMEOUT_SECONDS};${secure}`
        ]);

        rsp.writeHead(303, {'Content-Type': 'text/html', "Location": `${API_DIR}/site`});
        rsp.end(main.renderPage(req, null, {"msg": ["Logged in"], "title": `Logged in`, "link": `${API_DIR}/`}, db, API_DIR));
        return true;
    }

    // Failed login
    addFailedLogin(userId);
    fail(req, rsp, 'Bad username and/or password', db, API_DIR, body.email);
    return false;
}
this.login = login;

function logout(req, rsp, db, API_DIR) {
    rsp.setHeader('Set-Cookie', [
        `token=; Path=/; SameSite=Strict;`, // make secure later
        `user=; Path=/; SameSite=Strict;` // make secure later
    ]);
    rsp.writeHead(303, {'Content-Type': 'text/html', "Location": `${API_DIR}/`});
    rsp.end(main.renderPage(req, null, {"msg": ["Logged out"], "title": `Logged out`, "link": `${API_DIR}/`}, db, API_DIR));
}
this.logout = logout;

function set(req, rsp, id, formData, db, save, API_DIR) {
    var error = isSetInvalid(req, formData, db, id);
    if (error.length) {
        rsp.writeHead(400, {'Content-Type': 'text/html'});
        rsp.end(main.renderPage(req, template.password, Object.assign(main.addMessages("", error), {"token": formData.token, "email": formData.email, "id": id}), db, API_DIR));
        return;
    }

    updatePassword(id, formData, db, save);
    rsp.writeHead(303, {'Content-Type': 'text/html', "Location": `${API_DIR}/`});
    rsp.end(main.renderPage(req, null, {"msg": ["Password set"], "title": `Password set`, "link": `${API_DIR}/`}, db, API_DIR));
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

this.reset = function(req, rsp, id, db, save, API_DIR) {
    if (!main.isMod(req, db.user)) {
        rsp.writeHead(403, {'Content-Type': 'text/plain'});
        rsp.end('Only moderators can reset passwords.');
        return;
    }

    var token = resetPassword(id, db, save);

    var returnUrl = `https://${req.headers.host}${API_DIR}/password/${id}?token=${token}`;
    // sendResetEmail(returnUrl, rsp, data.user[path.id].email, 'reset-password');
    rsp.writeHead(200, {'Content-Type': 'text/plain'}).end(`Complete reset at: ${returnUrl}`);
    return;
};

this.update = function (req, rsp, id, formData, db, save, API_DIR) {
    if (!db.user[id]) {
        return main.notFound(rsp, req.url, 'PUT', req, db);
    }

    var error = isUpdateInvalid(formData, db, id);
    if (error.length) {
        rsp.writeHead(400, {'Content-Type': 'text/html'});
        rsp.end(main.renderPage(req, template.user, single(db, id, req, "", error), db, API_DIR));
        return;
    }

    // validate more fields
    updatePassword(id, formData, db, save);
    var returnData = main.responseData("", "", db, "Change Password", API_DIR, ["Password updated."]);

    if (req.headers.accept === 'application/json') {
        return main.returnJson(rsp, returnData);
    }

    returnData.back = req.headers.referer;
    rsp.writeHead(303, {'Content-Type': 'text/html', "Location": `${API_DIR}/login`});
    rsp.end(main.renderPage(req, null, returnData, db, API_DIR));
};

this.get = function (req, rsp, db, API_DIR) {
    if (req.headers.accept === 'application/json') {
        return main.returnJson(rsp, {});
    }

    rsp.writeHead(200, {'Content-Type': 'text/html'});
    rsp.end(main.renderPage(req, template.login, {}, db, API_DIR));
};

this.getPassword = function (req, rsp, id, db, API_DIR) {
    var qs = url.parse(req.url, true).query;
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
        rsp.end(main.renderPage(req, template.password, pwData, db, API_DIR));
    } else {
        rsp.writeHead(400, {'Content-Type': 'text/html'});
        rsp.end(main.renderPage(req, template.password, pwData, db, API_DIR));
    }
};

this.init = function(loginFail, lockoutDuration, sessionDuration) {
    LOGIN_FAIL_UNTIL_LOCKOUT = loginFail;
    LOCKOUT_DURATION_SECONDS = lockoutDuration;
    SESSION_TIMEOUT_SECONDS = sessionDuration;
};

async function loadData() {
    template.login = await main.readFile(`${__dirname}/login.html.mustache`, 'utf8');
    template.password = await main.readFile(`${__dirname}/password.html.mustache`, 'utf8');
    template.forgotPassword = await main.readFile(`${__dirname}/forgot-password.html.mustache`, 'utf8');
    template.user = await main.readFile(`${__dirname}/../user/user.html.mustache`, 'utf8');
}

loadData();