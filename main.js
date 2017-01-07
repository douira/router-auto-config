const http = require("http");
const querystring = require('querystring');
const util = require('util')
//const vm = require('vm');

const colors = require("colors/safe");
const values = require('object.values');

//shim Object.values
if (! Object.values) {
    values.shim();
}

//settings
const confidenceThreshold = 0.8; //minimum confidence to accept best determined device config
const probeTimeout = 6000; //device determining request timeout
const actionTimeout = 15000; //action timeout, loger than probeTimeout, because it may take the device some time to actually do what we told it to do
const requestUserAgent = "router-auto-config by douira"; //what to send as user agent in html headers
const printVerboseData = false; //enable to print lots of data about what's happening
const completeWithNoDataValidation = true; //continue evem when the response data isn't validated

//validate ok with reponse code 200
function okWithCode200(data, response) {
  return response.statusCode === 200;
}

//what routers we know and how to deal with them
const routerConfigs = [
  {
    //type display name
    name: "TP-LINK WR710N",
    //fields in reponse headers to check for equality, gotten from direct test request
    fingerprint: {
      "server":"Router Webserver",
      "connection":"close",
      "www-authenticate":"Basic realm=\"TP-LINK 150Mbps Wireless N Mini Pocket Router WR710N\"",
      "content-type":"text/html"
    },
    //additional data needed to perform actions
    data: {
      userName: "admin",
      password: "HXBn3506yvxA"
    },
    //actions which can be called on this router
    actions: {
      setWifiPassword: {
        /*array of actions to perform right before this one
        #actionParams are carried along from root action, action data is action specific, config data is persistent
        doBefore: ["..."],
        #array of actions to do directly after this action, like doBefore
        doAfter: ["..."],
        #unlike doBefore this onyl requires the given actions to have been peformed sometime beforehand
        #will only cause them to be performed beforehand, if they haven't ever been performed
        dependencies: ["..."],
        #like dependencies is to doBefore, these actions will be performed sometime after this, checked at end of action list
        consequences: ["..."],
        */

        //more data, passed as data.actionData to action performing functions
        actionData: {
          pathParts: [
            "/userRpm/WlanSecurityRpm.htm?secType=3&pskSecOpt=3&pskCipher=1&pskSecret=",   "&interval=0&wpaSecOpt=3&wpaCipher=1&radiusIp=&radiusPort=1812&radiusSecret=&intervalWpa=0&wepSecOpt=3&keytype=1&keynum=1&key1=&length1=0&key2=&length2=0&key3=&length3=0&key4=&length4=0&Save=Save"
          ]
        },
        //function returns http request options object, host is attached outside of this, required
        getOptions: (data, host) => {
          //the correct referrer, auth and the action GET data
          return {
            auth: data.userName + ":" + data.password, //auth with basic https auth
            path: data.actionData.pathParts[0] + data.actionParams.setPassword + data.actionData.pathParts[1],
            headers: {
              Referer: "http://" + host //makes the router happy, it just wants this, otherwise we get a 401
            }
          };
        },

        //returns data to send after the request headers for POST requests, optional
        //getPostData: (data) => { ... },

        //validates action success with response
        validateResponse: okWithCode200,
        //function verifies action success with data body sent, optional
        validateResponseData: (data, reponseData, response) => {
          return reponseData.indexOf(data.actionParams.setPassword) >= 0;
        }

        //uses reponse data and response headers to do things (as a prequisite for another action)
        //useResponse: (data, reponseData, response) => { ... }
      }
    }
  },
  {
    name: "EasyBox 904 xDSL",
    fingerprint: {
      "server":"Apache",
      "pragma":"no-cache",
      "cache-control":"max-age=0, must-revalidate",
      "connection":"close",
      "content-type":"text/html",
      "content-length":"29923"
    },
    data: {
      password: "snip",
      loginCookie: null, //both not gotten yet
      httoken: null
    },
    actions: {
      setWifiPassword: {
        dependencies: ["login"],
        actionData: {
          path: "/main_wifi.stm"
        },
        getOptions: (data, host) => {
          return {
            path: data.actionData.path,
            headers: {
              Cookie: data.loginCookie
            }
          };
        },
        validateResponse: (data, response) => {
          return true;
        },
        validateResponseData: (data, responseData, response) => {
          return true;
        },
        useResponse: (data, responseData, response) => {

        }
      },
      login: {
        doAfter: ["getToken"],
        consequences: ["logout"],
        actionData: {
          path: "/cgi-bin/login.exe"
        },
        getOptions: (data, host) => {
          return {
            path: data.actionData.path
          };
        },
        getPostData: (data) => {
          return {
            pws: data.password
          };
        },
        validateResponse: (data, response) => {
          return response.statusCode === 302 && response.headers.hasOwnProperty("set-cookie");
        },
        validateResponseData: (data, responseData, response) => {
          return responseData.indexOf("wait0.stm") >= 0;
        },
        useResponse: (data, responseData, response) => {
          //get cookie
          data.loginCookie = response.headers["set-cookie"][0].split(";")[0];
        }
      },
      getToken: {
        dependencies: ["login"],
        actionData: {
          path: "/main_overview.stm"
        },
        getOptions: (data, host) => {
          return {
            path: data.actionData.path,
            headers: {
              Cookie: data.loginCookie
            }
          };
        },
        validateResponse: okWithCode200,
        validateResponseData: (data, responseData, response) => {
          //if this string appears somewhere it's probably ok
          return responseData.indexOf("_httoken") >= 0;
        },
        useResponse: (data, responseData, response) => {
          //get httoken by evaulating line 23, which holds the js string to set the token
          data.httoken = eval("var _httoken = 0; " + responseData.split("\n")[23] + " _httoken");
        }
      },
      logout: {
        dependencies: ["login"],
        actionData: {
          path: "/cgi-bin/logout.exe"
        },
        getOptions: (data, host) => {
          return {
            path: data.actionData.path,
            headers: {
              Cookie: data.loginCookie
            }
          };
        },
        getPostData: (data) => {
          return {
            httoken: data.httoken
          };
        },
        validateResponse: (data, response) => {
          return response.statusCode === 302 &&
                 response.headers.hasOwnProperty("set-cookie") &&
                 response.headers["set-cookie"][0].indexOf("deleted") >= 0; //has delete cookie action
        },
        validateResponseData: (data, responseData, response) => {
          return responseData.indexOf("wait0.stm") >= 0;
        },
        useResponse: (data, responseData, response) => {

        }
      }
    }
  }
];

//returns object with logger functions
function createLogger(prefix) {
  const loggers = [
    //name of logger function with color name
    ["info", "cyan"],
    ["success", "green"],
    ["warn", "yellow"],
    ["error", "red"],
    ["debugBare", "magenta"]
  ].reduce((obj, logType) => {
    //add colorized logger
    obj[logType[0]] = (str) => {
      //use color with given name, add prefix and actual string
      console.log(colors[logType[1]](colors.bold(prefix) + str));
    }

    //return modified object
    return obj;
  }, {});

  //add wrapper to debug function
  loggers.debug = (name, data) => {
    //onyl if enabled
    if (printVerboseData) {
      //convert to string with utils if object
      if (typeof data === "object") {
        data = util.inspect(data);
      }

      //now print normally
      loggers.debugBare(name.toUpperCase() + ": " + data);
    }
  };

  //return loggers
  return loggers;
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
        if (headers[checkName] === config.fingerprint[checkName]) {
          confidence ++;
        }
      } //confidence point if value exists in headers but with other key name
      else if (Object.values(headers).some((value) => value === config.fingerprint[checkName])) {
        confidence ++;
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

//attaches timout and error handlers to requests
function attachRequestErrorHandlers(request, logger) {
  //keeps track of if an timeout has occured
  let timedOut = false;

  request
  //timeout handler
  .once("timeout", () => {
    //took too long for device to respond
    logger.error("Request timeout after " + request.timeout + "ms: Device took too long to respond.");

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
}

//adds the user agent to request options header property
function addUserAgentInfo(options) {
  //create headers object if not present
  if (! options.hasOwnProperty("headers")) {
    options.headers = {};
  }

  //add user agent name
  options.headers["User-Agent"] = requestUserAgent;

  //return modified options
  return options;
}

//finds the correct config for a given host address
function getHostConfig(host, callback, logger) {
  //send request to get reponse headers
  logger.info("Determining device type...");
  const request = http
  //send GET to host
  .request(
    //host and timeout, add user agent too
    addUserAgentInfo({
      hostname: host,
      timeout: probeTimeout
    }),
    (response) => {
      //use headers in fingerprints to determine device type
      let result = matchHeaders(response.headers);

      //actually found a device type
      if (result.config) {
        //minimum confidence
        if (result.confidence >= confidenceThreshold) {
          //warn if not 100%
          logger[result.confidence === 1 ? "success" : "warn"]("Device is '" + result.config.name + "' with " + asPercent(result.confidence) + "% confidence.");

          //callback with determined device config
          callback(result.config);
        } else {
          //less than threshold
          logger.error("Insufficient confidence determining device type: " + asPercent(result.confidence) + "% < " + asPercent(confidenceThreshold) + "%");
        }
      } else {
        //found no device
        logger.error("Device type could not be determined.")
      }
    }
  );

  //attach handlers
  attachRequestErrorHandlers(request, logger);

  //done sending request
  request.end();
}

//preprocesses action by binding config data to action functions
function preprocessAction(config, action, actionParams) {
  //check if already processed
  if (! action.hasOwnProperty("processed")) {
    //data to attach
    let data = config.data;

    //also has action specific data, if given
    if (action.hasOwnProperty("actionData")) {
      data.actionData = action.actionData;
    }

    //add actionParams to data
    data.actionParams = actionParams;

    //for all props of action that are functions
    for (let actionProp in action) {
      //is action function
      if (typeof action[actionProp] === "function") {
        //bind data argument and config as this
        action[actionProp] = action[actionProp].bind(config, data);
      }
    }

    //add processed flag
    action.processed = true;
  }

  //return processed action
  return action;
}

//returns true if an object has a property and its length is larger than 1
function checkArrayPropertyLength(object, propName) {
  return object.hasOwnProperty(propName) &&
         object[propName].hasOwnProperty["length"] &&
         object[propName].length > 0;
}

//returns a plural s if given array is loger than one
function puralS(array) {
  return array.length > 1 ? "s" : "";
}

//print that the response headers were validated, message dependent on validatiob method type
function printResponseValidMsg(specificResponseValidation) {
  if (specificResponseValidation) {
    logger.success("Response passed action specific validation.");
  } else {
    logger.warn("Validated reponse with status code 200.");
  }
}

//performs named action with given host and it's config, also gets additional data with actionParams
function performAction(host, config, actionName, logger, actionParams, nextActions, actionHistory) {
  //call next action if it's given
  let complete = () => {
    if (typeof nextActions !== "undefined" && nextActions.length) {
      //get next action
      const nextAction = nextActions.shift();

      //add current action to history
      actionHistory.push(actionName);

      //perform next action and pass remaining actions on
      performAction(host, config, nextAction, logger, actionParams, nextActions, actionHistory);
      //setTimeout(performAction.bind(undefined, host, config, nextAction, logger, actionParams, nextActions, actionHistory), 0);
    }
  }

  //true when orderSolved have been taken care of beforehand
  let orderSolved = false;

  //if action name is an object we set orderSolved and change actionName
  if (actionName.hasOwnProperty("name")) {
    orderSolved = true;
    actionName = actionName.name;

    //different log message, we are doing this action again after having resolved doBefores
    if (actionName.orderAffected) {
      logger.info("Resuming to perform action '" + actionName + "'...");
    }
  } else {
    logger.info("Performing action '" + actionName + "'...");
  }

  //order solve status
  logger.debug("order solved", orderSolved);

  //empty if not given
  if (typeof actionParams === "undefined") {
    actionParams = {};
  }
  if (typeof actionHistory === "undefined") {
    actionHistory = [];
  }

  //check if device has any actions
  if (config.hasOwnProperty("actions")) {
    //check that this device has this action and that the action returns options
    if (config.actions.hasOwnProperty(actionName) && config.actions[actionName].hasOwnProperty("getOptions")) {
      //current action to perform
      let currentAction = config.actions[actionName];

      //check if we need to do other actions beforehand, next, any time beforehand or sometime after this
      const beforePresent = checkArrayPropertyLength(currentAction, "doBefore");
      const afterPresent = checkArrayPropertyLength(currentAction, "doAfter");
      const depsPresent = checkArrayPropertyLength(currentAction, "dependencies");
      const conseqPresent = checkArrayPropertyLength(currentAction, "consequences");
      if (! orderSolved && (beforePresent || afterPresent || depsPresent || conseqPresent)) {
        //next actions to be done, includes directly next one
        let actions = [];

        //that the action is an object singifies that ordering has been/will have been taken care of!
        let currentActionObj = {
          name: actionName,
          orderAffected: beforePresent || afterPresent //set to true if actions we actually added
        };

        //dependencies actions present and need to be adresses (not in history)
        if (depsPresent) {
          //filter out already done ones, that are present in the history
          const addDeps = currentAction.dependencies.filter((action) => ! actionHistory.includes(action));

          //there are any
          if (addDeps.length) {
            logger.info("Dependency action" + puralS(addDeps) + " scheduled before the current one: " + addDeps.join(", "));

            //add to next actions first, before doBefore
            actions.push(...addDeps);
            currentActionObj.orderAffected = true;
          }
        }

        //doBefore actions present
        if (beforePresent) {
          logger.info("Preceding action" + puralS(currentAction.doBefore) + " scheduled right before the current one: " + currentAction.doBefore.join(", "));

          //add doBefore actions
          actions.push(...currentAction.doBefore.slice());
        }

        //index of current action in actions
        if (conseqPresent) { //only conseqPresent needs this
          var currentIndex = actions.length;
        }

        //add current one
        actions.push(currentActionObj);

        //following actions present
        if (afterPresent) {
          logger.info("Following action" + puralS(currentAction.doAfter) + " scheduled directly after the current one: " + currentAction.doAfter.join(", "));

          //add following actions
          actions.push(...currentAction.doAfter.slice());
        }

        //add current next actions after the current actions
        if (typeof nextActions !== "undefined") {
          actions.push(...nextActions);
        }

        //add consequences to end of everything
        if (conseqPresent) {
          //for each one, check if it doen't already appear after the current one
          const conseqActions = currentAction.consequences.filter((action) => actions.lastIndexOf(action) <= currentIndex);

          //onyl if any still have to be done
          if (conseqActions.length) {
            //add to end of action list
            logger.info("Following action" + puralS(conseqActions) + " scheduled sometime after the current one: " + conseqActions.join(", "));
            actions.push(...conseqActions);
            currentActionObj.orderAffected = true;
          }
        }

        //copy to nextActions
        nextActions = actions;

        //perform action with first doBefore and added next actions
        complete();
      } else { //do action now
        //preprocess action to perform
        currentAction = preprocessAction(config, currentAction, actionParams);

        //get request options from action
        let requestOptions = currentAction.getOptions(host);

        //we are doing a POST or not
        const post = currentAction.hasOwnProperty("getPostData");

        //add host and timeout option property
        requestOptions.hostname = host;
        requestOptions.timeout = actionTimeout;

        //user agent prop, also add html headers prop
        addUserAgentInfo(requestOptions);

        //method is post
        let postData;
        if (post) {
          //add method as POST
          requestOptions.method = "POST";

          //get post data
          postData = querystring.stringify(currentAction.getPostData());

          //add length header
          requestOptions.headers["Content-Length"] = Buffer.byteLength(postData)

          //post content data type
          requestOptions.headers["Content-Type"] = "application/x-www-form-urlencoded";
        }

        logger.debug("options", requestOptions);
        logger.debug("config data", config.data);
        logger.debug("action", currentAction);

        //send request to perform action
        const request = http.request(
          //processed options
          requestOptions,
          //handles reponse to verify success
          (response) => {
            //flag set to true if response is ok
            let validated;

            //use function if given to validate reponse
            const specificResponseValidation = currentAction.hasOwnProperty("validateResponse");
            if (specificResponseValidation) {
              //validate with function
              validated = currentAction.validateResponse(response);
              if (! validated) {
                logger.error("Response didn't pass action specific validation.");
              }
            } else {
              const statusCode = response.statusCode;

              //ok with status code 200
              validated = statusCode === 200;
              if (! validated) {
                logger.error("Response error with status code " + statusCode + " returned.");
              }
            }
            //successful header validation messages are printed later to try to merge them with the data validation messages

            logger.debug("response headers", response.headers);
            logger.debug("response code", response.statusCode);
            logger.debug("validated headers", validated);

            //proceed with response data validation
            if (validated) {
              //check for existance of functions that use response data
              const usesResponseData = currentAction.hasOwnProperty("useResponse");
              const specificDataValidation = currentAction.hasOwnProperty("validateResponseData");

              //check if we have to collect the reponse data
              if (printVerboseData || usesResponseData || specificDataValidation) {
                //collect response data
                let reponseData = [];

                //add length to counter on received data
                response
                .on("data", (chunk) => {
                  //collect data chunks
                  reponseData.push(chunk);
                })
                //validate data on completion of data sending
                .on("end", () => {
                  //reponse data string
                  const reponseString = reponseData.join();

                  logger.debug("response data", reponseString.split("\n").slice(0, 35).join("\n"));

                  //use reponse data (for next action for example)
                  if (usesResponseData) {
                    currentAction.useResponse(reponseString, response);
                  }

                  //validate response data
                  if (specificDataValidation) {
                    if (currentAction.validateResponseData(reponseString, response)) {
                      if (specificResponseValidation) {
                        logger.success("Response headers and data passed action specific validation.");
                      } else {
                        printResponseValidMsg(false);
                        logger.success("Response data passed action specific validation.");
                      }

                      //completion callback
                      complete();
                    } else {
                      printResponseValidMsg(specificResponseValidation);
                      logger.error("Response data didn't pass action specific validation.");
                    }
                  } else if (completeWithNoDataValidation) {
                    //complete if we're allowed and only here for logging
                    complete();
                  }
                });
              }

              //action does not have function for specific data validation
              if (! specificDataValidation) {
                printResponseValidMsg(specificResponseValidation);
                logger.warn("Cannot validate response data.");

                //complete if allowed
                if (completeWithNoDataValidation && ! usesResponseData) {
                  complete();
                }
              }
            }
          }
        );

        //attach handlers
        attachRequestErrorHandlers(request, logger);

        //send post data if this is a post request
        if (post) {
          logger.debug("post", postData);
          request.write(postData);
        }

        //done sending request
        request.end();
      }
    } else {
      //device type cannot perform this action
      logger.warn("This device type doesn't have a valid action '" + actionName + "'.");

      //completion callback
      complete();
    }
  } else {
    logger.error("This device type cannot perform any actions.");
  }
}

//combines determining device type and performing the action itself
function action(host, actionNames, actionParams) {
  //create logger for host
  logger = createLogger("[" + host + "]");

  //array of actions to be passed as next actions
  const nextActions = [];

  //true if there are any actions given
  let anyAction = actionNames.length > 0;

  //actionNames is an array
  if (typeof actionNames === "object") {
    //remove empty actions
    actionNames = actionNames.filter((name) => name.length);

    //still actions left
    if (actionNames.length) {
      //list is longer than a single element
      if (actionNames.length > 1) {
        logger.info("Performing list of actions: " + actionNames.join(", "));

        //set next actions to list of actions without the first one
        nextActions.push(...actionNames.slice(1));
      }

      //current action is the first one
      actionNames = actionNames[0];
    } else {
      //no actions after all
      anyAction = false;
    }
  }

  //get device type and do action then
  if (anyAction) {
    getHostConfig(host, (config) => {
      //do actions on success determining device type
      performAction(host, config, actionNames, logger, actionParams, nextActions);
    }, logger);
  } else {
    logger.warn("No action(s) specified.");
  }
}

//change password for host, action  has property setPassword in actionParams
/*action("192.168.2.160", "setWifiPassword", {
  setPassword: "A3fgnX5688bZ4y" //arbitrary
});*/
action("192.168.2.1", ["login"], {
  //setPassword: "blahblah"
});