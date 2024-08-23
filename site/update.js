/***
 * Öffimonitor - display the Wiener Linien timetable for nearby bus/tram/subway
 * lines on a screen in the Metalab Hauptraum
 *
 * Copyright (C) 2015-2016   Moritz Wilhelmy
 * Copyright (C) 2015-2016   Bernhard Hayden
 * Copyright (C) 2023-2023   Massimiliano Valeskini
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as
 * published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

"use strict";

var cached_json = {};

function capitalizeFirstLetter(str) {
  return str.replace(/\w[^- ]*/g, function (txt) { return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase(); });
}

function addZeroBefore(n) {
  return (n < 10 ? '0' : '') + n;
}

function showError(error) {
  document.querySelector('tbody').innerHTML = '';
  var last_update_string = '–';
  if (cached_json.departures) {
    cached_json.departures.forEach(function (departure) {
      addDeparture(departure);
    });
    last_update_string = new Date(cached_json.last_update).toTimeString();
  }

  document.getElementById("error").style.display = "block";
  document.getElementById("error_msg").innerHTML = error;
  document.getElementById("error_last_update").innerHTML = last_update_string;

  if (document.getElementById("warning").style.display === "block") {
    document.getElementById("warning").style.bottom = document.getElementById("error").offsetHeight + 'px';
  }
  console.log(error);
}

function warning() {
  if (!cached_json.warnings || cached_json.warnings.length === 0) {
    document.getElementById("warning").style.display = "none";
    return;
  }
  if (!cached_json.currentWarning) {
    cached_json.currentWarning = 0;
  }

  var currentWarning = cached_json.warnings[cached_json.currentWarning];
  document.getElementById("warning").style.display = "block";
  document.getElementById("warning_counter").innerHTML = (cached_json.currentWarning + 1) + '/' + cached_json.warnings.length;
  document.getElementById("warning_text").innerHTML = '<b>' + currentWarning.title + '</b> ' + currentWarning.description;

  if (cached_json.warnings.length - 1 > cached_json.currentWarning) {
    cached_json.currentWarning++;
  } else {
    cached_json.currentWarning = 0;
  }
}

function clock() {
  var currentTime = new Date();
  document.getElementById('currentTime').innerHTML = addZeroBefore(currentTime.getHours()) + ":"
    + addZeroBefore(currentTime.getMinutes()) + ":"
    + addZeroBefore(currentTime.getSeconds());
}

function update() {
  document.getElementById("error").style.display = "none";
  if (document.getElementById("warning").style.display === "block") {
    document.getElementById("warning").style.bottom = '0%';
  }

  var req = new XMLHttpRequest();
  req.open('GET', '/api');
  req.onreadystatechange = function () {
    if (req.readyState !== 4) { return }

    if (req.status !== 200) {
      showError('No connection to server');
      return;
    }

    try {
      var json = JSON.parse(req.responseText);
      if (json.status && json.status === 'error') {
        throw (json.error);
      } else if (json.status && json.status !== 'ok') {
        throw ('Server response unvalid')
      }

      document.querySelector('tbody').innerHTML = '';
      json.departures.forEach(function (departure) {
        addDeparture(departure);
      });
      cached_json.departures = json.departures;
      cached_json.warnings = json.warnings;
      cached_json.last_update = new Date().toString();
    } catch (e) {
      showError(e);
    }
  };
  req.send();
}

function addDeparture(departure) {
  var departureRow = document.createElement('tr');
  var now = new Date();
  var departureTime = new Date(departure.time);
  var difference = (departureTime.getTime() - now.getTime()) / 1000;
  var walkDuration = departure.walkDuration;
  var walkStatus = departure.walkStatus;

  if (difference < 0 || walkDuration * 0.9 > difference) {
    walkStatus = 'too late';
    return false;
  } else if (walkDuration + 2 * 60 > difference) {
    walkStatus = 'hurry';
  } else if (walkDuration + 5 * 60 > difference) {
    walkStatus = 'soon';
  }

  var line = departure.line;
  var type = departure.type;

  if (type === 'tram') {
    line = '<span class="tram">' + line + '</span>';
  } else if (line.toString().includes("N")) {
    line = '<span class="nightline">' + line + '</span>';
  } else if (type === 'bus') {
    line = '<span class="bus">' + line + '</span>';
  }

  var timeString = '<b>' + addZeroBefore(departureTime.getHours()) +
    ':' + addZeroBefore(departureTime.getMinutes()) +
    '</b>&nbsp;';

  var differenceString = '+';

  if (difference > 3600) {
    differenceString += Math.floor(difference / 3600) + 'h';
    difference = difference % 3600;
  }

  differenceString += addZeroBefore(Math.floor(difference / 60)) + 'm';
  difference = difference % 60;

  differenceString += parseInt(difference / 10) + '0s';

  departureRow.innerHTML = '<tr><td class="time ' + walkStatus +
    '">' + timeString + differenceString + '</td>' +
    '<td>' + line + '</td><td>' + departure.stop +
    '</td><td>' + capitalizeFirstLetter(departure.towards) +
    '</td>';
  document.querySelector('tbody').appendChild(departureRow);
}


/* SPEKTRAL CHECK - IGNORE THIS SECTION */
const speki = false;
const spekiurl = "";
/* SPEKTRAL CHECK - IGNORE THIS SECTION */


// Funktion zum Extrahieren der Stunden und Minuten aus einem Zeit-String
function parseTime(timeStr) {
  const [hour, minute] = timeStr.split(/[:\.]/).map(str => parseInt(str));
  return { hour, minute };
}

// Funktion zum Prüfen, ob die aktuelle Zeit innerhalb einer Zeitspanne liegt
function isTimeWithinRange(currentTime, rangeStr) {
  const [startTimeStr, endTimeStr] = rangeStr.split('-').map(str => str.trim());
  const { hour: startHour, minute: startMinute } = parseTime(startTimeStr);
  const { hour: endHour, minute: endMinute } = parseTime(endTimeStr);
  const start = new Date();
  start.setHours(startHour, startMinute, 0, 0);
  const end = new Date();
  end.setHours(endHour, endMinute, 0, 0);
  return currentTime >= start && currentTime <= end;
}

// Funktion zum Überprüfen, ob das Event in einer der relevanten Locations stattfindet
function isEventInRelevantLocation(locationStr) {
  const relevantLocations = ['KC', 'VK', 'OO'];
  for (const loc of relevantLocations) {
    if (locationStr.includes(loc)) {
      return true;
    }
  }
  return false;
}

// Hauptfunktion zum Überprüfen der Events und Ausgabe in der Konsole
async function checkEvents() {
  if (!speki) return;
  try {
    const response = await axios.get(spekiurl); // URL der JSON-Antwort
    const currentTime = new Date(); // Aktuelle Zeit
    const events = response.data; // Array der Events
    const dateRegex = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/;
    let eventFound; // Variable, die angibt, ob ein Event gefunden wurde 

    for (const event of events) {
      const [dateStr, dayStr, rangeStr, locationStr, ...rest] = event;
      if (!dateRegex.test(dateStr)) {
        continue; // continue if dateStr is not in the format "dd.mm.yyyy"
      }
      const [_, day, month, year] = dateStr.match(dateRegex);

      const eventDate = new Date(`${month}/${day}/${year}`);
      if (!eventDate); // Wenn das Datum nicht gefunden wurde, überspringen
      if (eventDate.toDateString() !== currentTime.toDateString()) {
        continue; // Wenn das Datum nicht übereinstimmt, überspringen
      }
      if (!isEventInRelevantLocation(locationStr)) {
        continue; // Wenn das Event nicht in einer relevanten Location stattfindet, überspringen
      }
      const isWithinRange = isTimeWithinRange(currentTime, rangeStr);
      const isEndingSoon = isTimeWithinRange(new Date(currentTime.getTime() + 30 * 60 * 1000), rangeStr);
      const isEndedRecently = isTimeWithinRange(new Date(currentTime.getTime() - 90 * 60 * 1000), rangeStr);
      if (isWithinRange || isEndingSoon || isEndedRecently) {
        eventFound = true;
      }
    }
    // Wenn kein Event gefunden wurde, outputte nichts auf den Bildschirm
    if (!eventFound) {
      axios.post('/sleep');
    } else {
      axios.post('/wake');
    }
  } catch (error) {
    console.error(error);
  }
}

window.onload = function () {
  clock();
  update();
  warning();
  checkEvents();
  window.setInterval(clock, 1000);
  window.setInterval(update, 10000);
  window.setInterval(warning, 5000);
  window.setInterval(checkEvents, 1000 * 60 * 15);
};