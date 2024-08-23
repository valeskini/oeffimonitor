const express = require("express");
const http = require("http");
const url = require("url");
const apicache = require("apicache");
const settings = require(__dirname + "/settings.js");
const package = require(__dirname + "/../package.json");
const axios = require("axios");
const cheerio = require('cheerio');
const { XMLParser } = require("fast-xml-parser");
const { link } = require("fs");
const { exec } = require('child_process');
const speki = false;

let app = express();
let cache = apicache.middleware;
let walkcache = [];

app.use(express.static(__dirname + "/../site"));

app.get("/api", cache(settings.api_cache_msec), (req, res) => {
  console.log("API: new request");
  getData((data) => res.json(data));
});

if (speki) {
  app.post('/sleep', (req, res) => {
    exec('xset dpms force off');
  });

  app.post('/wake', (req, res) => {
    exec('xset dpms force on');
  });
}


app.listen(settings.listen_port, () => {
  console.log("Server up on port", settings.listen_port);
});

const errorHandler = (error, cb) => {
  console.error(error);
  cb({
    status: "error",
    error: error,
  });
};

const getData = async (cb) => {
  try {
    const parser = new XMLParser();
    let services = [];

    const promises = settings.stops.map(async (stop) => {
      let xml1 = `<Trias version="1.2"><ServiceRequest><siri:RequestTimestamp>2018-11-21T17:00:00Z</siri:RequestTimestamp><siri:RequestorRef>mdv</siri:RequestorRef><RequestPayload><StopEventRequest><Location><LocationRef><StopPointRef>${stop[0]}</StopPointRef><LocationName><Text>${stop[1]}</Text><Language>de</Language></LocationName></LocationRef></Location></StopEventRequest></RequestPayload></ServiceRequest></Trias>`;
      const config1 = {
        method: "post",
        maxBodyLength: Infinity,
        url: "http://ogdtrias.verbundlinie.at:8183/stv/trias",
        headers: {
          "Content-Type": "application/xml",
        },
        data: xml1,
      };
      const response1 = await axios.request(config1);
      let jObj1 = parser.parse(response1.data);

      let xml2 = `<Trias version="1.2"><ServiceRequest><siri:RequestTimestamp>2018-11-21T17:00:00Z</siri:RequestTimestamp><siri:RequestorRef>SEUS</siri:RequestorRef><RequestPayload><LocationInformationRequest><InitialInput><LocationName>${stop[1]}</LocationName></InitialInput></LocationInformationRequest></RequestPayload></ServiceRequest></Trias>`;
      const config2 = {
        method: "post",
        maxBodyLength: Infinity,
        url: "http://ogdtrias.verbundlinie.at:8183/stv/trias",
        headers: {
          "Content-Type": "application/xml",
        },
        data: xml2,
      };
      const response2 = await axios.request(config2);
      let jObj2 = parser.parse(response2.data);

      let location;
      if (
        jObj2["trias:Trias"]["trias:ServiceDelivery"]["trias:DeliveryPayload"][
          "trias:LocationInformationResponse"
        ]["trias:LocationResult"].length
      ) {
        location = [
          jObj2["trias:Trias"]["trias:ServiceDelivery"]["trias:DeliveryPayload"][
          "trias:LocationInformationResponse"
          ]["trias:LocationResult"][0]["trias:Location"]["trias:GeoPosition"][
          "trias:Longitude"
          ],
          jObj2["trias:Trias"]["trias:ServiceDelivery"]["trias:DeliveryPayload"][
          "trias:LocationInformationResponse"
          ]["trias:LocationResult"][0]["trias:Location"]["trias:GeoPosition"][
          "trias:Latitude"
          ],
        ];
      } else {
        location = [
          jObj2["trias:Trias"]["trias:ServiceDelivery"]["trias:DeliveryPayload"][
          "trias:LocationInformationResponse"
          ]["trias:LocationResult"]["trias:Location"]["trias:GeoPosition"][
          "trias:Longitude"
          ],
          jObj2["trias:Trias"]["trias:ServiceDelivery"]["trias:DeliveryPayload"][
          "trias:LocationInformationResponse"
          ]["trias:LocationResult"]["trias:Location"]["trias:GeoPosition"][
          "trias:Latitude"
          ],
        ];
      }
      let results =
        jObj1["trias:Trias"]["trias:ServiceDelivery"]["trias:DeliveryPayload"][
        "trias:StopEventResponse"
        ]["trias:StopEventResult"];
      await results.map(async (result) => {
        result["trias:StopEvent"]["trias:GeoPosition"] = location;
      });
      return results;
    });

    const results = await Promise.all(promises);
    services = services.concat(...results);
    flatten(services, cb);
  }
  catch (error) {
    console.log(error);
  }
};

const getOSRM = (coordinates) => {
  if (!settings.osrm_api_url) {
    // no OSRM server defined
    return;
  }

  const findCoordinates = (element) => {
    return (
      element.coordinates[0] === coordinates[0] &&
      element.coordinates[1] === coordinates[1]
    );
  };

  if (walkcache.find(findCoordinates)) {
    return walkcache.find(findCoordinates).duration;
  }

  console.log("OSRM: new request for", coordinates);
  const osrm_url = url.parse(
    settings.osrm_api_url +
    coordinates[0] +
    "," +
    coordinates[1] +
    "?overview=false"
  );

  let duration;

  http
    .get(
      {
        protocol: osrm_url.protocol,
        host: osrm_url.host,
        path: osrm_url.path,
        headers: {
          "User-Agent":
            "Öffimonitor/" +
            package.version +
            " <https://github.com/massitheduck/oeffimonitor>",
        },
      },
      (response) => {
        let data = "";
        response.on("data", (chunk) => (data += chunk));
        response.on("end", () => {
          try {
            duration = JSON.parse(data).routes[0].duration;
            if (!walkcache.find(findCoordinates)) {
              walkcache.push({ coordinates: coordinates, duration: duration });
            }
          } catch (e) { }
        });
        response.on("error", (err) => console.error(err));
      }
    )
    .on("error", (err) => console.error(err));

  return duration;
};

const flatten = async (services, cb) => {
  const parser = new XMLParser();
  let data = [];
  let warnings = [];
  let now = new Date();

  await services.map(async (service) => {
    // filter stuff as defined in settings.filters
    if (
      settings.filters &&
      !!settings.filters.find((filter) => {
        const keys = Object.keys(filter);
        // check if there is a filter with only stop and line defined
        if (keys.length === 2 && !!filter.stop && !!filter.line) {
          // filter if both stop and line match
          return (
            filter.stop.indexOf(
              service["trias:StopEvent"]["trias:ThisCall"]["trias:CallAtStop"][
              "trias:StopPointName"
              ]["trias:Text"]
            ) > -1 &&
            filter.line.indexOf(
              service["trias:StopEvent"]["trias:Service"][
              "trias:ServiceSection"
              ]["trias:PublishedLineName"]["trias:Text"]
            ) > -1
          );
        }
        // else check if there is a filter for the whole line
        return (
          keys.length === 1 &&
          keys[0] === "line" &&
          filter.line.indexOf(
            service["trias:StopEvent"]["trias:Service"]["trias:ServiceSection"][
            "trias:PublishedLineName"
            ]["trias:Text"]
          ) > -1
        );
      })
    ) {
      return;
    }

    // calculate most accurate known departure time
    let time;

    let timeReal =
      service["trias:StopEvent"]["trias:ThisCall"]["trias:CallAtStop"][
      "trias:ServiceDeparture"
      ]["trias:RecordedAtTime"];
    let timeEst =
      service["trias:StopEvent"]["trias:ThisCall"]["trias:CallAtStop"][
      "trias:ServiceDeparture"
      ]["trias:EstimatedTime"];
    let timePlan =
      service["trias:StopEvent"]["trias:ThisCall"]["trias:CallAtStop"][
      "trias:ServiceDeparture"
      ]["trias:TimetabledTime"];

    if (timeReal !== undefined) {
      // if realtime data is available, use that
      time = new Date(timeReal);
    } else if (timeEst !== undefined) {
      // if not, use estimated data
      time = new Date(timeEst);
    } else {
      // if not, use scheduled data
      time = new Date(timePlan);
    }

    let walkDuration = getOSRM(service["trias:StopEvent"]["trias:GeoPosition"]);
    let differenceToNow = (time.getTime() - now.getTime()) / 1000;
    let walkStatus;
    if (typeof walkDuration === "undefined") {
      // no walkDuration, no walkStatusStopEventResult
    } else if (walkDuration > differenceToNow) {
      walkStatus = "late";
    } else if (walkDuration + 2 * 60 > differenceToNow) {
      walkStatus = "hurry";
    } else if (walkDuration + 5 * 60 > differenceToNow) {
      walkStatus = "soon";
    }

    data.push({
      stop: service["trias:StopEvent"]["trias:ThisCall"]["trias:CallAtStop"][
        "trias:StopPointName"
      ]["trias:Text"],
      coordinates: service["trias:StopEvent"]["trias:GeoPosition"],
      line: service["trias:StopEvent"]["trias:Service"]["trias:ServiceSection"][
        "trias:PublishedLineName"
      ]["trias:Text"],
      type: service["trias:StopEvent"]["trias:Service"]["trias:ServiceSection"][
        "trias:Mode"
      ]["trias:PtMode"],
      towards:
        service["trias:StopEvent"]["trias:Service"]["trias:DestinationText"][
        "trias:Text"
        ],
      barrierFree: false,
      time: time,
      timePlanned: timePlan,
      timeReal: timeReal,
      countdown: undefined,
      walkDuration: walkDuration,
      walkStatus: walkStatus,
    });
  });

  data.sort((a, b) => {
    return a.time < b.time ? -1 : a.time > b.time ? 1 : 0;
  });

  let trafficInfos = [];
  await axios.get("https://verbundlinie.at/de/fahrplan/rund-um-den-fahrplan/verkehrsmeldungen")
    .then((response) => {
      const $ = cheerio.load(response.data);
      const reports = $('div.jp-start > ul > li');
      reports.each((i, report) => {
        const title = $(report).find('h3 > a').text();
        if (title === "Stadt- und Umlandverkehr Graz (Zone 101)") {
          const messages = $(report).find('.linverz_linie');
          messages.each((j, message) => {
            const lines = $(message).find('.linverz_lnr_stoerung').text().trim();
            const description = $(message).find('.linverz_teilstrecke > strong').text().trim();
            if (lines !== "" && description !== "") {
              trafficInfos.push({
                title: lines,
                description: description,
              });
            }
          });
        }
      });
    })
    .catch((error) => {
      console.error(error);
    });

  trafficInfos.push({
    title: "Achtung!",
    description: "Liebe Spektralbesucher*Innen, bitte schaltet den Monitor <strong>EIN</strong> bevor ihr geht. Er schaltet sich dann automatisch aus!",
  });
  warnings = trafficInfos.map((trafficInfo) => {
    return { title: trafficInfo.title, description: trafficInfo.description };
  });

  cb({ status: "ok", departures: data, warnings: warnings });
};
