var http = require("http");
var colors = require("colors/safe");

function createLogger(prefix) {
  //create object with logger functions
  return [
    //name of logger function with color name
    ["info", "cyan"],
    ["success", "green"],
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
};

function authRequest(host, path, userName, password, callback) {
  //make http request
  http.request(
    {
      //pass given params
      hostname: host,
      auth: userName + ":" + password, //auth with basic https auth
      path: path,
      headers: {
        Referer: "http://" + host //makes the router happy, it just wants this, otherwise we get a 401
      }
    },
    //use callback with bound logging function
    callback.bind(null, createLogger("[" + host + "]"))
  )
  //handle errors by printing them
  .on("error", (e) => {
    console.log(colors.red("problem with request: " + e.message));
  })
  //close when done
  .end();
}
//given to request to handle what's sent back
function getResponseHandler(checkResponse) {
  return (logger, response) => {
    //gets status code from response
    const statusCode = response.statusCode;

    //check for ok code
    if (statusCode === 200) {
      //print ok with code
      logger.info("Auth login ok with status code " + statusCode);
      //log("HEADERS: " + JSON.stringify(response.headers));

      //collect response data
      let reponseData = [];

      //add length to counter on received data
      response
      .on("data", (chunk) => {
        reponseData.push(chunk);
        //log(chunk);
      })
      //handle counted length on end of transmission
      .on("end", () => {
        if (checkResponse(reponseData.join())) {
          logger.success("Succes of request action verified.");
        } else {
          logger.error("Failed to verify succes of request action!");
        }
      });
    } else {
      //error when code isn't 200
      logger.error("Received status code " + statusCode + " on auth.");
    }
  }
}

//sets the password
function setWifiPassword(newPassword) {
  //make a request to change the wifi password
  authRequest(
    "192.168.2.160", //ip of router to send this to, is a TL-WR710N
    "/userRpm/WlanSecurityRpm.htm?secType=3&pskSecOpt=3&pskCipher=1&pskSecret=" + newPassword + "&interval=0&wpaSecOpt=3&wpaCipher=1&radiusIp=&radiusPort=1812&radiusSecret=&intervalWpa=0&wepSecOpt=3&keytype=1&keynum=1&key1=&length1=0&key2=&length2=0&key3=&length3=0&key4=&length4=0&Save=Save",
    "admin", //web interface login name
    "HXBn3506yvxA", //login password
    //handles response data and looks for password in reponse to verify success
    getResponseHandler((reponseData) => {
      return reponseData.indexOf(newPassword) >= 0;
    })
  );
}

setWifiPassword("A3fgnX5688bZ4y");

/* sniffed original packet from real browser usage, old: A3fgnX5688bZ4x, new: A3fgnX5688bZ4y

GET /userRpm/WlanSecurityRpm.htm?secType=3&pskSecOpt=3&pskCipher=1&pskSecret=A3fgnX5688bZ4y&interval=0&wpaSecOpt=3&wpaCipher=1&radiusIp=&radiusPort=1812&radiusSecret=&intervalWpa=0&wepSecOpt=3&keytype=1&keynum=1&key1=&length1=0&key2=&length2=0&key3=&length3=0&key4=&length4=0&Save=Save HTTP/1.1
Host: 192.168.2.160
Connection: keep-alive
Upgrade-Insecure-Requests: 1
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/55.0.2883.95 Safari/537.36
Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,* /*;q=0.8
Referer: http://192.168.2.160/userRpm/WlanSecurityRpm.htm?secType=3&pskSecOpt=3&pskCipher=1&pskSecret=A3fgnX5688bZ4x&interval=0&wpaSecOpt=3&wpaCipher=1&radiusIp=&radiusPort=1812&radiusSecret=&intervalWpa=0&wepSecOpt=3&keytype=1&keynum=1&key1=&length1=0&key2=&length2=0&key3=&length3=0&key4=&length4=0&Save=Save
Accept-Encoding: gzip, deflate, sdch
Accept-Language: de-DE,de;q=0.8,en-US;q=0.6,en;q=0.4

*/
