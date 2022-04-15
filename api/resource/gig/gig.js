const showdown  = require('showdown');
const converter = new showdown.Converter({"noHeaderId": true, "simpleLineBreaks": true});

const main = require('../../inc/main.js');
var url = require('url');

const resourceName = 'gig';
const template = {};

function gigTimes(date, startTime, durationH, durationM) {
    var gigStart = new Date(date + "T" + startTime + ":00");
    var hourStart = gigStart.getHours();
    var minuteStart = gigStart.getMinutes();
    var durationHms = parseInt(durationH, 10) * 60 * 60 * 1000;
    var durationMms = parseInt(durationM, 10) * 60 * 1000;

    var gigEnd = new Date(+gigStart + durationHms + durationMms);
    var hourEnd = gigEnd.getHours();
    var minuteEnd = gigEnd.getMinutes();

    var amPmStart = "AM";
    if (hourStart >= 12) {
        amPmStart = "PM";
    }
    if (hourStart > 12) {
        hourStart = hourStart - 12;
    }

    if (minuteStart) {
        if (minuteStart < 10) {
            minuteStart = ":0" + minuteStart;
        } else {
            minuteStart = ":" + minuteStart;
        }
    } else {
        minuteStart = "";
    }

    var amPmEnd = "AM";
    if (hourEnd >= 12) {
        amPmEnd = "PM";
    }
    if (hourEnd > 12) {
        hourEnd = hourEnd - 12;
    }
    if (minuteStart) {
        if (minuteEnd < 10) {
            minuteEnd = ":0" + minuteEnd;
        } else {
            minuteEnd = ":" + minuteEnd;
        }
    } else {
        minuteEnd = "";
    }
    if (amPmStart === amPmEnd) {
        return `${hourStart}${minuteStart} - ${hourEnd}${minuteEnd} ${amPmEnd}`;
    }
    return `${hourStart}${minuteStart} ${amPmStart} - ${hourEnd}${minuteEnd} ${amPmEnd}`;
}

function updateResource(id, formData, db, save) {
    db[resourceName][id].title = formData.title;
    db[resourceName][id].date = formData.date;
    db[resourceName][id].startTime = formData.startTime;
    db[resourceName][id].durationH = formData.durationH;
    db[resourceName][id].durationM = formData.durationM;
    db[resourceName][id].venue = formData.venue;
    db[resourceName][id].desc = formData.desc;
    save();
}

function venueList(db, id) {
    const venues = [];
    Object.keys(db.venue).forEach(v => {
        var selected = "";
        if (id && db[resourceName][id].venue === v) {
            selected = ' selected="selected"';
        }
        venues.push({
            "id": v,
            "name": db.venue[v].name,
            "selected": selected
        });
    });
    return venues.sort(main.sortByName);
}

function single(db, id, msg, error) {
    var pageName = db[resourceName][id].title;
    if (!pageName) {
        pageName = `${db[resourceName][id].date} ${db.venue[db[resourceName][id].venue].name}`;
    }
    var resourceData = Object.assign({
        "id": id,
        "resourceName": resourceName,
        "pageName": pageName,
        "venues": venueList(db, id),
        "venueName": db.venue[db[resourceName][id].venue].name
    }, db[resourceName][id]);

    return Object.assign(main.addMessages(msg, error), resourceData);
}

function singleNoAuth(db, id) {
    var pageName = db[resourceName][id].title;
    if (!pageName) {
        pageName = `${db[resourceName][id].date} ${db.venue[db[resourceName][id].venue].name}`;
    }
    var resourceData = Object.assign({
        "id": id,
        "resourceName": resourceName,
        "pageName": pageName,
        "venueName": db.venue[db[resourceName][id].venue].name,
        "descHtml": converter.makeHtml(db[resourceName][id].desc),
        "startTimes": gigTimes(db[resourceName][id].date, db[resourceName][id].startTime, db[resourceName][id].durationH, db[resourceName][id].durationM)
    }, db[resourceName][id]);

    return resourceData;
}

function list(req, db, msg, error, link) {
    var qs = url.parse(req.url, true).query;
    var now = new Date();
    var gigs = main.objToArray(db[resourceName]);
    var pageName = "Gigs";

    if (qs.range === "upcoming") {
        gigs.sort(main.sortByDate);
        gigs = gigs.filter(g => {
            return Date.parse(g.date + "T23:59:59") >= +now;
        });
        pageName = "Upcoming Gigs";
    } else if (qs.range === "past") {
        gigs.sort(main.sortByDateDesc);
        gigs = gigs.filter(g => {
            return Date.parse(g.date + "T23:59:59") < +now;
        });
        pageName = "Past Gigs";
    } else {
        gigs.sort(main.sortByDate);
    }

    gigs.forEach(g => {
        g.venueName = db.venue[g.venue].name;
        g.gigName = (g.title) ? g.title : db.venue[g.venue].name;
        g.formattedDate = main.dateFormat(g.date + "T00:00:01");
    });

    var resourceData = {
        "gig": gigs,
        "resourceName": resourceName,
        "venues": venueList(db, ""),
        "pageName": pageName
    };
    return Object.assign(main.addMessages(msg, error, link), resourceData);
}

function listNoAuth(req, db) {
    var qs = url.parse(req.url, true).query;
    var now = new Date();
    var gigs = main.objToArray(db[resourceName]);
    var pageName = "Shows";
    var otherPage = {
        "name": "See Upcoming Shows",
        "url": "?range=upcoming"
    };

    if (qs.range === "upcoming") {
        gigs.sort(main.sortByDate);
        gigs = gigs.filter(g => {
            return Date.parse(g.date + "T23:59:59") >= +now;
        });
        pageName = "Upcoming Shows";
        otherPage = {
            "name": "See Previous Shows",
            "url": "?range=past"
        };
    } else if (qs.range === "past") {
        gigs.sort(main.sortByDateDesc);
        gigs = gigs.filter(g => {
            return Date.parse(g.date + "T23:59:59") < +now;
        });
        pageName = "Previous Shows";
    } else {
        gigs.sort(main.sortByDate);
    }

    gigs.forEach(g => {
        g.venueName = db.venue[g.venue].name;
        g.gigName = (g.title) ? g.title : db.venue[g.venue].name;
        g.formattedDate = main.dateFormat(g.date + "T00:00:01");
        g.descHtml = converter.makeHtml(g.desc);
        g.startTimes = gigTimes(g.date, g.startTime, g.durationH, g.durationM);
    });

    return {
        "gig": gigs,
        "resourceName": resourceName,
        "today": main.dateFormat(new Date()),
        "pageName": pageName,
        "otherPage": otherPage
    };
}

function singleData(db, id, mapKey) {
    return Object.assign({
        "resourceName": resourceName,
        "venueData": Object.assign({"MAP_KEY": mapKey}, db.venue[db[resourceName].venue])
    }, db[resourceName][id]);
}

function listData(db, req, mapKey) {
    var qs = url.parse(req.url, true).query;
    var now = new Date();
    var gigData = {};
    gigData.resourceName = resourceName;
    gigData.gigs = main.objToArray(db[resourceName]).map(gig => {
        gig.venueData = db.venue[gig.venue];
        gig.venueData.MAP_KEY = mapKey;
        return gig;
    });
    if (qs.range === "upcoming") {
        gigData.gigs.sort(main.sortByDate);
        gigData.gigs = gigData.gigs.filter(gig => {
            return Date.parse(gig.date + "T23:59:59") >= +now;
        });
    } else if (qs.range === "past") {
        gigData.gigs.sort(main.sortByDateDesc);
        gigData.gigs = gigData.gigs.filter(gig => {
            return Date.parse(gig.date + "T23:59:59") < +now;
        });
    } else {
        gigData.gigs.sort(main.sortByDate);
    }

    return gigData;
}

// Form validation
function isUpdateInvalid(formData) {
    var msg = [];

    if (!formData.date) {
        msg.push('Date is required.');
    }

    if (!formData.startTime) {
        msg.push('Start time is required.');
    }

    if (!formData.venue) {
        msg.push('Venue is required.');
    }

    // return main.invalidMsg(rsp, msg, req, db, API_DIR);
    return msg;
}

this.create = function (req, rsp, formData, db, save, API_DIR) {
    var error = isUpdateInvalid(formData);
    if (error.length) {
        rsp.writeHead(400, {'Content-Type': 'text/html'});
        rsp.end(main.renderPage(req, template.list, Object.assign({
            "hasError": true,
            "error": error,
            "formData": formData
        }, list(req, db)), db, API_DIR));
        // ^ this needs selected values too
        return;
    }

    var id = main.createResource(formData, db, save, resourceName, updateResource);
    var returnData = main.responseData(id, resourceName, db, "Created", API_DIR);

    if (req.headers.accept === 'application/json') {
        rsp.setHeader("Location", `${API_DIR}/${resourceName}/${id}`);
        return main.returnJson(rsp, returnData, 201);
    }

    // returnData.back = req.headers.referer;
    rsp.writeHead(200, {'Content-Type': 'text/html'});
    // rsp.end(main.renderPage(req, null, returnData, db, API_DIR));
    rsp.end(main.renderPage(req, template.list, Object.assign({
        "hasMsg": true,
        "link": {"text": `Created ${resourceName} id ${id}`, "href": `${API_DIR}/${resourceName}/${id}`}
    }, list(req, db)), db, API_DIR));
};

this.update = function (req, rsp, id, formData, db, save, API_DIR) {
    if (!db[resourceName][id]) {
        return main.notFound(rsp, req.url, 'PUT', req, db);
    }
    var error = isUpdateInvalid(formData);
    if (error.length) {
        rsp.writeHead(400, {'Content-Type': 'text/html'});
        rsp.end(main.renderPage(req, template.single, single(db, id, "", error), db, API_DIR));
        return;
    }

    updateResource(id, formData, db, save);
    var returnData = main.responseData(id, resourceName, db, "Updated", API_DIR);

    if (req.headers.accept === 'application/json') {
        // rsp.setHeader("Location", `${API_DIR}/${resourceName}/${id}`);
        return main.returnJson(rsp, returnData);
    }

    // returnData.back = req.headers.referer;
    rsp.writeHead(200, {'Content-Type': 'text/html'});
    // rsp.end(main.renderPage(req, null, returnData, db, API_DIR));
    rsp.end(main.renderPage(req, template.single, single(db, id, [`${resourceName} id ${id} updated.`]), db, API_DIR));
};

this.remove = function (req, rsp, id, db, save, API_DIR) {
    var name;
    if (!db[resourceName][id]) {
        return main.notFound(rsp, req.url, 'DELETE', req, db);
    }

    name = db[resourceName][id].date;
    delete db[resourceName][id];
    save();

    var returnData = main.responseData(id, resourceName, db, "Deleted", API_DIR, [`${resourceName} '${name}' deleted.`]);

    if (req.headers.accept === 'application/json') {
        return main.returnJson(rsp, returnData);
    }

    rsp.writeHead(200, {'Content-Type': 'text/html'});
    rsp.end(main.renderPage(req, null, returnData, db, API_DIR));
};

this.get = function (req, rsp, id, db, API_DIR, mapKey) {
    rsp.setHeader('Cache-Control', 'max-age=0,no-cache,no-store,post-check=0,pre-check=0');
    if (id) {
        if (!db[resourceName][id]) {
            return main.notFound(rsp, req.url, 'GET', req, db);
        }
        if (req.headers.accept === 'application/json') {
            return main.returnJson(rsp, singleData(db, id, mapKey));
        }
        rsp.writeHead(200, {'Content-Type': 'text/html'});
        if (main.isLoggedIn(req, db.user)) {
            rsp.end(main.renderPage(req, template.single, single(db, id), db, API_DIR));
        } else {
            rsp.end(main.renderPage(req, template.singleNoAuth, singleNoAuth(db, id), db, API_DIR));
        }
    } else {
        if (req.headers.accept === 'application/json') {
            return main.returnJson(rsp, listData(db, req, mapKey));
        }
        rsp.writeHead(200, {'Content-Type': 'text/html'});
        if (main.isLoggedIn(req, db.user)) {
            rsp.end(main.renderPage(req, template.list, list(req, db), db, API_DIR));
        } else {
            rsp.end(main.renderPage(req, template.listNoAuth, listNoAuth(req, db), db, API_DIR));
        }
    }
};

async function loadData() {
    template.single = await main.readFile(`${__dirname}/${resourceName}.html.mustache`, 'utf8');
    template.singleNoAuth = await main.readFile(`${__dirname}/${resourceName}-noauth.html.mustache`, 'utf8');

    template.list = await main.readFile(`${__dirname}/${resourceName}s.html.mustache`, 'utf8');
    template.listNoAuth = await main.readFile(`${__dirname}/${resourceName}s-noauth.html.mustache`, 'utf8');
}

loadData();
