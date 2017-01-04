function authRequest(loginData, host, path, callback) {
  //make http request
  http
    .request(
      {
        //pass given params
        hostname: host,
        auth: loginData.userName + ":" + loginData.password, //auth with basic https auth
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
      logger.info("HEADERS: " + JSON.stringify(response.headers));

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

//sets the wifi password
function setWifiPassword(newPassword) {
  //make a request to change the wifi password
  authRequest(
    loginData, //use login data for current main router
    "192.168.2.160", //ip of router to send this to, is a TL-WR710N
    "/userRpm/WlanSecurityRpm.htm?secType=3&pskSecOpt=3&pskCipher=1&pskSecret=" + newPassword + "&interval=0&wpaSecOpt=3&wpaCipher=1&radiusIp=&radiusPort=1812&radiusSecret=&intervalWpa=0&wepSecOpt=3&keytype=1&keynum=1&key1=&length1=0&key2=&length2=0&key3=&length3=0&key4=&length4=0&Save=Save",
    //handles response data and looks for password in reponse to verify success
    getResponseHandler((reponseData) => {
      return reponseData.indexOf(newPassword) >= 0;
    })
  );
}

var loginData = {
  userName: "admin", //web interface login name
  password: "HXBn3506yvxA" //login password
};

//setWifiPassword("A3fgnX5688bZ4y");

/*http
  .request(
    {
      hostname: "192.168.2.160",
    },
    (response) => {
      console.log("HEADERS: " + JSON.stringify(response.headers));
    }
  )
  //handle errors by printing them
  .on("error", (e) => {
    console.log(colors.red("problem with request: " + e.message));
  })
  //close when done
  .end();
*/