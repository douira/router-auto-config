//TODO: test consequences


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
const rootLogger = createLogger("SCHEDULER"); //logger for scheduler

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
        getOptions: (data, host) => ({
          //the correct referrer, auth and the action GET data
          auth: data.userName + ":" + data.password, //auth with basic https auth
          path: data.actionData.pathParts[0] + data.actionParams.setPassword + data.actionData.pathParts[1],
          headers: {
            Referer: "http://" + host //makes the router happy, it just wants this, otherwise we get a 401
          }
        }),

        //returns data to send after the request headers for POST requests, optional
        //getPostData: data => ({ ... }),

        //validates action success with response
        validateResponse: okWithCode200,
        //function verifies action success with data body sent, optional
        validateResponseData: (data, reponseData, response) => reponseData.indexOf(data.actionParams.setPassword) >= 0,

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
      loginCookie: null, //both not gotten yet
      httoken: null
    },
    actions: {
      setWifiPassword: {
        dependencies: ["login"],
        actionData: {
          path: "/main_wifi.stm"
        },
        getOptions: (data, host) => ({
          path: data.actionData.path,
          headers: {
            Cookie: data.loginCookie
          }
        }),
        validateResponse: (data, response) => true,
        validateResponseData: (data, responseData, response) => true,
        useResponse: (data, responseData, response) => {

        }
      },
      login: {
        doAfter: ["getToken"],
        consequences: ["logout"],
        actionData: {
          password: "snip",
          path: "/cgi-bin/login.exe"
        },
        getOptions: (data, host) => ({
          path: data.actionData.path
        }),
        getPostData: data => ({
          pws: data.actionData.password
        }),
        validateResponse: (data, response) => response.statusCode === 302 && response.headers.hasOwnProperty("set-cookie"),
        validateResponseData: (data, responseData, response) => responseData.indexOf("wait0.stm") >= 0,
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
        getOptions: (data, host) => ({
          path: data.actionData.path,
          headers: {
            Cookie: data.loginCookie
          }
        }),
        validateResponse: okWithCode200,
        //if this string appears somewhere it's probably ok
        validateResponseData: (data, responseData, response) => responseData.indexOf("_httoken") >= 0,
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
        getOptions: (data, host) => ({
          path: data.actionData.path,
          headers: {
            Cookie: data.loginCookie
          }
        }),
        getPostData: data => ({
          httoken: data.httoken
        }),
        validateResponse: (data, response) => response.statusCode === 302 &&
                                              response.headers.hasOwnProperty("set-cookie") &&
                                              response.headers["set-cookie"][0].indexOf("deleted") >= 0, //has delete cookie action
        validateResponseData: (data, responseData, response) => responseData.indexOf("wait0.stm") >= 0,
        useResponse: (data, responseData, response) => {

        }
      }
    }
  }
];

//returns object with logger functions
function createLogger(prefix) {
  //wrap the prefix in sqare brackets
  prefix = "[" + prefix + "]";

  //logging names and colors
  const loggers = [
    //name of logger function with color name
    ["info", "cyan"],
    ["success", "green"],
    ["warn", "yellow"],
    ["error", "red"],
    ["debugBare", "magenta"]
  ].reduce((obj, logType) => {
    //add colorized logger
    obj[logType[0]] = str => {
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
    .map(config => {
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
        else if (Object.values(headers).some(value => value === config.fingerprint[checkName])) {
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
    .on("error", e => {
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

  //send GET to host
  const request = http.request(
    //host and timeout, add user agent too
    addUserAgentInfo({
      hostname: host,
      timeout: probeTimeout
    }),
    response => {
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
function pluralS(value) {
  return ((typeof value === "object") ? value.length : value) > 1 ? "s" : "";
}

//print that the response headers were validated, message dependent on validatiob method type
function printResponseValidMsg(specificResponseValidation) {
  if (specificResponseValidation) {
    logger.success("Response passed action specific validation.");
  } else {
    logger.warn("Validated reponse with status code 200.");
  }
}

//converts array of mixed object and non object action to only string actions
function toStringActions(array) {
  return array.map(action => (typeof action === "object") ? action.name : action);
}

//gets action name from an action name object or string
function getName(actionName) {
  return (typeof actionName === "object") ? actionName.name : actionName;
}

//performs named action with given host and it's config, also gets additional data with actionParams
function performAction(host, config, actionIdentifier, logger, actionParams, finishCallback, nextActions, actionHistory) {
  //call next action if it's given
  let complete = addToHistory => {
    //add current action to history if enabled
    logger.debug("add to history", addToHistory);
    logger.debug("name add", actionName);
    if (addToHistory) {
      actionHistory.push(actionName);
    }

    //still actions to go
    if (typeof nextActions !== "undefined" && nextActions.length) {
      //get next action
      const nextAction = nextActions.shift();

      //perform next action and pass remaining actions on
      let doNextAction = performAction.bind(null, host, config, nextAction, logger, actionParams, finishCallback, nextActions, actionHistory);

      //insert delay if set
      if (actionParams.delay > 0) {
        setTimeout(doNextAction, actionParams.delay);
      } else {
        doNextAction();
      }
    } else {
      //end of actions, call finishCallback to finish, with successful flag set to true
      finishCallback(host, actionHistory, logger, true);
    }
  }

  //call with host history and logger to finishCallback, successful is false
  let failed = () => {
    logger.error("Action '" + actionName + "' failed.");
    finishCallback(host, actionHistory, logger, false);
  }

  //empty if not given
  if (typeof actionParams === "undefined") {
    actionParams = {};
  }
  if (typeof actionHistory === "undefined") {
    actionHistory = [];
  }

  //true when orderSolved have been taken care of beforehand
  let orderSolved = false;

  //get name of action
  const actionName = getName(actionIdentifier);

  //continue with next action directly if this is a consequence that has been resolved
  if (actionIdentifier.hasOwnProperty("isConsequence") &&
      actionIdentifier.isConsequence &&
      actionHistory.lastIndexOf(actionIdentifier.name) > actionIdentifier.afterIndex) {
    logger.debug("consequense flow", "Skipped action '" + actionName + "' because it already appeared after the action with this action as a consequence.")
    complete(false);
  }

  //if action name is an object we set orderSolved and change actionName
  orderSolved = actionIdentifier.hasOwnProperty("orderAffected");
  if (orderSolved) {
    //different log message, we are doing this action again after having resolved doBefores
    if (actionIdentifier.orderAffected) {
      logger.info("Resuming to perform action '" + actionName + "'...");
    }
  } else {
    logger.info("Performing action '" + actionName + "'...");
  }
  logger.debug("order solved", orderSolved);

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

        //that the action is an object signifies that ordering has been/will have been taken care of!
        let currentActionObj = {
          name: actionName,
          orderAffected: beforePresent || afterPresent //set to true if actions we actually added
        };

        //dependencies actions present and need to be adresses (not in history)
        if (depsPresent) {
          //filter out already done ones, that are present in the history
          const addDeps = currentAction.dependencies.filter(action => actionHistory.indexOf(action) === -1);

          //there are any
          if (addDeps.length) {
            logger.info("Dependency action" + pluralS(addDeps) + " scheduled before the current one: " + addDeps.join(", "));

            //add to next actions first, before doBefore
            actions.push(...addDeps);
            currentActionObj.orderAffected = true;
          }
        }

        //doBefore actions present
        if (beforePresent) {
          logger.info("Preceding action" + pluralS(currentAction.doBefore) + " scheduled right before the current one: " + currentAction.doBefore.join(", "));

          //add doBefore actions
          actions.push(...currentAction.doBefore.slice());
        }

        //add current one
        const currentIndex = actions.length;
        actions.push(currentActionObj);

        //following actions present
        if (afterPresent) {
          logger.info("Following action" + pluralS(currentAction.doAfter) + " scheduled directly after the current one: " + currentAction.doAfter.join(", "));

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
          let conseqActions = currentAction.consequences.filter(action => toStringActions(actions).lastIndexOf(action) <= currentIndex);

          //onyl if any still have to be done
          if (conseqActions.length) {
            logger.info("Following action" + pluralS(conseqActions) + " scheduled sometime after the current one: " + conseqActions.join(", "));

            //map to action name objects
            conseqActions = conseqActions.map(name => ({
              name: name,
              isConsequence: true,

              //keep track of index of the current action in actionHistory so that we can prevent duplicate execution of the consequence actions when they appear as a consequence after they've been already performed for another cause
              afterIndex: actionHistory.length //current length of history is index where current action will be placed in history
            }));

            //add to end of action list
            actions.push(...conseqActions);
            currentActionObj.orderAffected = true;
          }
        }

        //copy to nextActions
        nextActions = actions;

        //perform action with first doBefore and added next actions, dont add to history because we only did the ordering this time
        complete(false);
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
          response => {
            //flag set to true if response is ok
            let validated;

            //use function if given to validate reponse
            const specificResponseValidation = currentAction.hasOwnProperty("validateResponse");
            if (specificResponseValidation) {
              //validate with function
              validated = currentAction.validateResponse(response);
              if (! validated) {
                logger.error("Response didn't pass action specific validation.");
                failed();
              }
            } else {
              const statusCode = response.statusCode;

              //ok with status code 200
              validated = statusCode === 200;
              if (! validated) {
                logger.error("Response error with status code " + statusCode + " returned.");
                failed();
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
                  .on("data", chunk => {
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
                        complete(true);
                      } else {
                        printResponseValidMsg(specificResponseValidation);
                        logger.error("Response data didn't pass action specific validation.");
                        failed();
                      }
                    } else if (completeWithNoDataValidation) {
                      //complete if we're allowed and only here for logging
                      complete(true);
                    }
                  });
              }

              //action does not have function for specific data validation
              if (! specificDataValidation) {
                printResponseValidMsg(specificResponseValidation);
                logger.warn("Cannot validate response data.");

                //complete if allowed
                if (completeWithNoDataValidation && ! usesResponseData) {
                  if (completeWithNoDataValidation) {
                    complete(true);
                  } else {
                    //failed if cant complete with no validation
                    failed();
                  }
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
      complete(true);
    }
  } else {
    logger.error("This device type cannot perform any actions.");
    failed();
  }
}

//gets formatted time from hrtime tuple array
function formatElapsedTime(arr, digits) {
  return (arr[0] + arr[1] / 1e9).toFixed(digits) + "s";
}

//called when there are no more actions for a device, end of action list
function deviceActionsDone(startTime, doneHostsAccumulator, host, actionHistory, logger, success) {
  //print done for this device
  logger[success ? "success" : "warn"]("Performed " + actionHistory.length + " action" + pluralS(actionHistory) + ": " + actionHistory.join(", "));
  if (! success) {
    logger.error("Didn't complete all actions.")
  }

  //print timer
  const timeElapsed = process.hrtime(startTime);
  logger.info("Time elapsed for this device: " + formatElapsedTime(timeElapsed, 3));

  //increment accumulator
  if (doneHostsAccumulator.use) {
    doneHostsAccumulator.addFinish(success);
  }
}

//returns an accumulator object that has two properties ok and error and a method to check completion
function createAccumulator(totalHosts, rootLogger, everythingDone) {
  return {
    ok: 0, //hosts that completed all actions successfully
    error: 0, //hosts that encountered an error,
    use: true, //enabled use of this accumulator
    total: totalHosts, //sum of hosts to wait for
    //checks if all hosts have finished
    checkComplete: function() {
      //if total is 0 we will be silent
      if (this.total > 0) {
        const sum = this.ok + this.error;

        //reached total number of hosts to finish
        if (sum === this.total) {
          //call done callback
          everythingDone(this.ok, this.error, this.total, rootLogger);
        } else if (sum > this.total) {
          rootLogger.warn("More hosts reported finishing than were started. (" + sum + " > " + this.total + ")");
        }
      }
    },
    //called when a host finishes
    addFinish: function(success) {
      //increment corresponding counter
      this[success ? "ok" : "error"] ++;

      //check if done
      this.checkComplete();
    }
  }
}

//combines determining device type and performing the action itself
function action(hosts, actionNames, rootLogger, actionParams, doneHostsAccumulator) {
  //true if there are any actions given
  let anyAction = actionNames.length > 0;

  //actionNames is an array
  if (typeof actionNames === "object") {
    //remove empty actions
    actionNames = actionNames
      .map(name => name.trim())
      .filter(name => name.length);

    //still actions left
    if (actionNames.length) {
      //list is longer than a single element
      if (actionNames.length > 1) {
        rootLogger.info("Performing list of actions: " + actionNames.join(", "));
      }
    } else {
      //no actions after all
      anyAction = false;
    }
  }

  //empty actionParams if none given
  if (typeof actionParams === "undefined") {
    actionParams = {};
  }

  //there are actions
  if (anyAction) {
    //put into array if single
    if (typeof hosts !== "object") {
      hosts = [hosts];
    }

    //empty fake accumulator if none given
    if (typeof doneHostsAccumulator === "undefined") {
      doneHostsAccumulator = { use: false };
    }

    //filter hosts
    hosts = hosts
      .map(str => str.trim()) //remove whitespace
      .filter(str => str.length) //remove ones that are now empty
      .filter((host, index, array) => array.indexOf(host) !== index); //remove duplicates

    //only if there are still more than 1 actions
    if (hosts.length > 1) {
      rootLogger.info("Processing list of hosts: " + hosts.join(", "));

      //create done accumulator
      const accumulator = createAccumulator(hosts.length, rootLogger, (ok, error, total, logger) => {
        //done message
        logger[error === 0 ? "success" : "warn"]("OK: " + ok + " host" + pluralS(ok) + ", with error(s): " + error + " host" + pluralS(error) + ", total: " + total + " host" + pluralS(total));

        logger.debug("memory usage", process.memoryUsage());
      });

      //call action for all hosts
      hosts.forEach(host => action(host, actionNames, rootLogger, actionParams, accumulator));
    } else if (hosts.length) { //single
      //convert to single value
      const host = hosts[0];

      //get tiem from start of interfaceing with this device
      const startTime = process.hrtime();

      //create logger for host
      const logger = createLogger(host);

      //get device type and then do actions
      getHostConfig(host, config => {
        //do actions on success determining device type, empty accumulator with use as false to be quiet
        performAction(host,
                      config,
                      actionNames[0],
                      logger,
                      actionParams,
                      deviceActionsDone.bind(null, startTime, doneHostsAccumulator),
                      actionNames.slice(1));
      }, logger);
    } else {
      rootLogger.warn("No valid host(s) given.");
    }
  } else {
    logger.warn("No action(s) specified.");
  }
}

//change password for host, action  has property setPassword in actionParams
/*action("192.168.2.160", "setWifiPassword", {
  setPassword: "A3fgnX5688bZ4y" //arbitrary
});*/
action("192.168.2.1", ["login"], rootLogger, {
  //a delay can be set here that is applied between calls of performAction
  //delay: <milliseconds>,

  //setPassword: "blahblah"
});