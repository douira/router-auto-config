const http = require("http");
const colors = require("colors/safe");

//settings
const confidenceThreshold = 0.9; //minimum confidence to accept best determined device config
const probeTimeout = 1000; //device determining request timeout

//what routers we know and how to deal with them
const routerConfigs = [
  {
    name: "TP-LINK WR710N", //type display name
    fingerprint: { //fields in reponse headers to check for equality, gotten from direct test request
      "server":"Router Webserver",
      "connection":"close",
      "www-authenticate":"Basic realm=\"TP-LINK 150Mbps Wireless N Mini Pocket Router WR710N\"",
      "content-type":"text/html"
    },
    data: { //additional data needed to perform actions
      userName: "admin",
      password: "HXBn3506yvxA"
    },
    actions: { //actions that can be acalled on this router
      setWifiPassword: {
        //more data, passed as data.actionData to action performing functions
        actionData: {
          pathParts: [
            "/userRpm/WlanSecurityRpm.htm?secType=3&pskSecOpt=3&pskCipher=1&pskSecret=",   "&interval=0&wpaSecOpt=3&wpaCipher=1&radiusIp=&radiusPort=1812&radiusSecret=&intervalWpa=0&wepSecOpt=3&keytype=1&keynum=1&key1=&length1=0&key2=&length2=0&key3=&length3=0&key4=&length4=0&Save=Save"
          ]
        },
        //function returns http request options object
        getOptions: (data, host, actionParams) => {
          //object has host, the correct referrer, auth and the action GET data
          return {
            hostname: host,
            auth: loginData.userName + ":" + loginData.password, //auth with basic https auth
            path: data.actionData.pathParts[0] + actionParams.setPassword + data.actionData.pathParts[1],
            headers: {
              Referer: "http://" + host //makes the router happy, it just wants this, otherwise we get a 401
            }
          };
        },
        //if it had been necessary, we could give a function here of which the reponse is sent for POST requests
        //getPostData: (data) => { ... },
        //function verifies action success
        verify: (data, reponseData) => {
          return reponseData.indexOf(newPassword) >= 0;
        }
      }
    }
  },
  {
    name: "EasyBoy 904 xDSL",
    fingerprint: {
      "server":"Apache",
      "pragma":"no-cache",
      "cache-control":"max-age=0, must-revalidate",
      "connection":"close",
      "content-type":"text/html",
      "content-length":"29923"
    }
  }
];

//returns object with logger functions
function createLogger(prefix) {
  return [
    //name of logger function with color name
    ["info", "cyan"],
    ["success", "green"],
    ["warn", "yellow"],
    ["error", "red"]
  ].reduce((obj, logType) => {
    //add colorized logger
    obj[logType[0]] = (str) => {
      //use color with given name, add prefix and actual string
      console.log(colors[logType[1]](colors.bold(prefix) + str));
    }

    //return modified object
    return obj;
  }, {});
}

//determines number of properties an object has
function getObjectPropAmount(obj) {
  return Object.keys(obj).length;
}

//uses fingerprints to determine the best device match for the reponse headers
function matchHeaders(headers) {
  return routerConfigs
    //match with all configs and calculate similarity to fingerprints
    .map((config) => {
      //determine match confidence
      let confidence = 0;

      //for all fingerprint fieds
      for (let checkName in config.fingerprint) {
        //check presence in given headers
        if (headers.hasOwnProperty(checkName)) {
          //similarity increases confidence
          confidence ++;

          //check match with given headers
          if (headers.hasOwnProperty(checkName)) {
            confidence ++;
          }
        }
      }

      //check header amount match
      if (getObjectPropAmount(config.fingerprint) === getObjectPropAmount(headers)) {
        confidence ++;
      }

      //return confidence as percentage by dividing through possible max amount of points
      return confidence / (getObjectPropAmount(config.fingerprint) * 2 + 1);
    })
    //find config for highest confidence value
    .reduce((best, confidence, configIndex) => {
      //confidence is largest than current best
      if (best.confidence < confidence) {
        //change best to new confidence and config
        best.confidence = confidence;
        best.config = routerConfigs[configIndex];
      }

      //return modifed object
      return best;
    }, {
      confidence: 0,
      config: null
    });
}

//return decimal number as percent int
function asPercent(fraction) {
  return Math.ceil(fraction * 100)
}

//finds the correct config for a given host address
function getHostConfig(host, callback) {
  const logger = createLogger("[" + host + "]");

  //keeps track of if an timeout has occured
  let timedOut = false;

  //send request to get reponse headers
  logger.info("Determining device type...");
  let request = http
    //send GET to host
    .request(
      //bare bones
      {
        hostname: host,
        timeout: probeTimeout
      },
      (response) => {
        //logger.info("HEADERS: " + JSON.stringify(response.headers));

        //use headers in fingerprints to determine device type
        let result = matchHeaders(response.headers);

        //atually found a device type
        if (result.config) {
          //minimum confidence
          if (result.confidence >= confidenceThreshold) {
            //warn if not 100%
            logger[result.confidence === 1 ? "success" : "warn"]("Device is '" + result.config.name + "' with " + asPercent(result.confidence) + "% confidence.");

            //callback with determined device config
            callback(result.config);
          } else {
            //less than threshold
            logger.error("Device type could not be determined with " + asPercent(result.confidence) + " < " + asPercent(confidenceThreshold) + "% sufficient confidence.");
          }
        } else {
          //found no device
          logger.error("Device type could not be determined.")
        }
      }
    )
    .once("timeout", () => {
      //took too long for device to respond
      logger.error("Request timeout after " + probeTimeout + "ms: Device took too long to respond.");

      //actually stop the request
      request.abort();

      //set flag to prevent another error message
      timedOut = true;
    })
    //handle errors by printing them
    .on("error", (e) => {
      if (! timedOut) {
        logger.error("Problem with request: " + e.message);
      }
    });

  //done sending request
  request.end();
}

getHostConfig("192.168.2.11", (config) => {});