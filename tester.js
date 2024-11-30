const axios = require('axios');
let data = JSON.stringify({
  "instanceKey": "darkadm",
  "chatId": "5517991134416",
  "funnelId": "834ed34a-0f00-4a60-8936-4d4cc796427e"
});

let config = {
  method: 'post',
  maxBodyLength: Infinity,
  url: 'https://dev.hocketzap.com/api/v2/funnel/execute',
  headers: { 
    'Content-Type': 'application/json', 
    'x-api-key': 'hkt_96a4f4596a6a4fa29b3f9db971855b96',
  },
  data : data
};

axios.request(config)
.then((response) => {
  console.log(JSON.stringify(response.data));
})
.catch((error) => {
  console.log(error);
});
