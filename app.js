'use strict';
const PAGE_ACCESS_TOKEN = process.env.PAGE_ACCESS_TOKEN;
const APP_URL = process.env.APP_URL;

//new text

// Imports dependencies and set up http server
const 
  { uuid } = require('uuidv4'),
  {format} = require('util'),
  request = require('request'),
  express = require('express'),
  body_parser = require('body-parser'),
  firebase = require("firebase-admin"),
  ejs = require("ejs"),  
  fs = require('fs'),
  multer  = require('multer'),  
  app = express(); 

const uuidv4 = uuid();
const session = require('express-session');

app.use(body_parser.json());
app.use(body_parser.urlencoded());
app.use(session({secret: 'effystonem'}));

const bot_questions = {
  "q1": "please enter you name",
  "q2": "please enter your phone number",
  "q3": "please enter your address",
  "q4": "please enter your order reference number" 
}

let sess;

let current_question = '';
let user_id = ''; 
let userInputs = [];
let first_reg = false;
let customer = [];


let temp_points = 0;
let cart_total = 0;
let cart_discount = 0;

/*
var storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/')
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  }
})*/

const upload = multer({ 
  storage: multer.memoryStorage(),
  limits :{
    fileSize: 50 * 1024 * 1024  //no larger than 5mb
  }

});

// parse application/x-www-form-urlencoded


app.set('view engine', 'ejs');
app.set('views', __dirname+'/views');


var firebaseConfig = {
     credential: firebase.credential.cert({
    "private_key": process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    "client_email": process.env.FIREBASE_CLIENT_EMAIL,
    "project_id": process.env.FIREBASE_PROJECT_ID,    
    }),
    databaseURL: process.env.FIREBASE_DB_URL,   
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET
  };



firebase.initializeApp(firebaseConfig);

let db = firebase.firestore(); 
let bucket = firebase.storage().bucket();

// Sets server port and logs message on success
app.listen(process.env.PORT || 1337, () => console.log('webhook is listening'));

// Accepts POST requests at /webhook endpoint
app.post('/webhook', (req, res) => {  
   
  // Parse the request body from the POST
  let body = req.body;



  

  // Check the webhook event is from a Page subscription
  if (body.object === 'page') {
    body.entry.forEach(function(entry) {

      let webhook_event = entry.messaging[0];
      let sender_psid = webhook_event.sender.id;       
      
      user_id = sender_psid; 

      if(!userInputs[user_id]){
        userInputs[user_id] = {};
        customer[user_id] = {};
      } 
               

      if (webhook_event.message) {
        if(webhook_event.message.quick_reply){
            handleQuickReply(sender_psid, webhook_event.message.quick_reply.payload);
          }else{
            handleMessage(sender_psid, webhook_event.message);                       
          }                
      } else if (webhook_event.postback) {        
        handlePostback(sender_psid, webhook_event.postback);
      }
      
    });
    // Return a '200 OK' response to all events
    res.status(200).send('EVENT_RECEIVED');

  } else {
    // Return a '404 Not Found' if event is not from a page subscription
    res.sendStatus(404);
  }

});


app.use('/uploads', express.static('uploads'));


app.get('/',function(req,res){    
    res.send('your app is up and running');
});


app.get('/admin/products', async(req,res) =>{   

   
  const productsRef = db.collection('products').orderBy('created_on', 'desc');
  const snapshot = await productsRef.get();

  if (snapshot.empty) {
    res.send('no data');
  }else{
    let data = []; 

  snapshot.forEach(doc => {
    let product = {};
    
    product = doc.data();
    product.doc_id = doc.id;
    
    let d = new Date(doc.data().created_on._seconds);
    d = d.toString();
    product.created_on = d;
    

    data.push(product);
    
  });
  
  res.render('products.ejs', {data:data});

  }

  
});

app.get('/admin/addproduct', async function(req,res){
  res.render('addproduct.ejs');  
});

app.post('/admin/saveproduct',upload.single('file'),function(req,res){
       
      let name  = req.body.name;
      let description = req.body.description;
      let img_url = "";
      let price = parseInt(req.body.price); 
      let sku = req.body.sku;

      let today = new Date();

      


      let file = req.file;
      if (file) {
        uploadImageToStorage(file).then((img_url) => {
            db.collection('products').add({
              name: name,
              description: description,
              image: img_url,
              price:price,
              sku:sku,
              created_on:today
              }).then(success => {   
                console.log("DATA SAVED")
                res.redirect('../admin/products');    
              }).catch(error => {
                console.log(error);
              }); 
        }).catch((error) => {
          console.error(error);
        });
      }             
});

app.get('/admin/orders', async(req,res)=>{

  const ordersRef = db.collection('orders').orderBy('created_on', 'desc');
  const snapshot = await ordersRef.get();

  if (snapshot.empty) {
    res.send('no data');
  } else{

      let data = []; 

  snapshot.forEach(doc => {
    let order = {};
    
    order = doc.data();
    order.doc_id = doc.id;
    
    let d = new Date(doc.data().created_on._seconds);
    d = d.toString();
    order.created_on = d;
    

    data.push(order);
    
  });


  res.render('order_records.ejs', {data:data});


  }

    
});


app.get('/admin/update_order/:doc_id', async function(req,res){
  let doc_id = req.params.doc_id; 
  
  const orderRef = db.collection('orders').doc(doc_id);
  const doc = await orderRef.get();
  if (!doc.exists) {
    console.log('No such document!');
  } else {
    
    let data = doc.data();
    data.doc_id = doc.id;
    
    res.render('update_order.ejs', {data:data});
  } 

});


app.post('/admin/update_order', function(req,res){
   

  let data = {
    ref:req.body.ref,
    name:req.body.name,
    phone:req.body.phone,
    address:req.body.address,
    items:req.body.items,
    sub_total:req.body.sub_total,
    discount:req.body.discount,
    total:req.body.total,
    payment_type:req.body.payment_type,
    status:req.body.status,
    comment:req.body.comment,
  }

  db.collection('orders').doc(req.body.doc_id)
  .update(data).then(()=>{
      res.redirect('/admin/orders');
  }).catch((err)=>console.log('ERROR:', error)); 
 
});


//route url
app.get('/shop', async function(req,res){

  customer[user_id].id = user_id;

  const userRef = db.collection('users').doc(user_id);
  const user = await userRef.get();
  if (!user.exists) {
    customer[user_id].name = ""; 
    customer[user_id].phone = "";
    customer[user_id].address = "";
    customer[user_id].points = 0;
         
  } else {
      customer[user_id].name = user.data().name; 
      customer[user_id].phone = user.data().phone; 
      customer[user_id].address = user.data().address; 
      
      customer[user_id].points = user.data().points; 
       
  } 


  const productsRef = db.collection('products').orderBy('created_on', 'desc');
  const snapshot = await productsRef.get();

  if (snapshot.empty) {
    res.send('no data');
  } 

  let data = []; 

  snapshot.forEach(doc => { 
    
    let product = {}; 

    product = doc.data();
    
    product.id = doc.id; 
    
    let d = new Date(doc.data().created_on._seconds);
    d = d.toString();
    product.created_on = d;   

    data.push(product);
    
  });  

  //console.log('DATA:', data); 
  res.render('shop.ejs', {data:data});

});


app.post('/cart', function(req, res){
    
    if(!customer[user_id].cart){
        customer[user_id].cart = [];
    }
    
    let item = {};
    item.id = req.body.item_id;
    item.name = req.body.item_name;
    item.price = parseInt(req.body.item_price);
    item.qty = parseInt(req.body.item_qty);
    item.total = item.price * item.qty; 


    const itemInCart = (element) => element.id == item.id;
    let item_index = customer[user_id].cart.findIndex(itemInCart); 

    if(item_index < 0){
        customer[user_id].cart.push(item);
    }else{
        customer[user_id].cart[item_index].qty = item.qty;
        customer[user_id].cart[item_index].total = item.total;
    }      
     
    res.redirect('../cart');   
});


app.get('/cart', function(req, res){     
    temp_points = customer[user_id].points; 
    let sub_total = 0;
    cart_total = 0;
    cart_discount = 0;

    if(!customer[user_id].cart){
        customer[user_id].cart = [];
    }
    if(customer[user_id].cart.length < 1){
        res.send('your cart is empty. back to shop <a href="../shop">shop</a>');
    }else{ 

        customer[user_id].cart.forEach((item) => sub_total += item.total);        

        cart_total = sub_total - cart_discount;       

        customer[user_id].use_point = false;

        res.render('cart.ejs', {cart:customer[user_id].cart, sub_total:sub_total, user:customer[user_id], cart_total:cart_total, discount:cart_discount, points:temp_points});    
    }
});



app.get('/emptycart', function(req, res){  
    customer[user_id].cart = [];
    customer[user_id].use_point = false;
    //customer[user_id].points = 400;
    cart_discount = 0;
    res.redirect('../cart');    
});


app.post('/pointdiscount', function(req, res){

    //temp_points = customer[user_id].points; 
    let sub_total = 0;
    //cart_total = 0;
    //cart_discount = 0;
  
    if(!customer[user_id].cart){
        customer[user_id].cart = [];
    }
    if(customer[user_id].cart.length < 1){
        res.send('your cart is empty. back to shop <a href="../shop">shop</a>');
    }else{ 
        customer[user_id].use_point = true;        

        customer[user_id].cart.forEach((item) => sub_total += item.total); 

        console.log('BEFORE');
        console.log('sub total:'+sub_total);
        console.log('cart total:'+cart_total);
        console.log('cart discount:'+cart_discount);
        console.log('temp points:'+ temp_points);
       
        if(sub_total != 0 || cart_total != 0){
          if(sub_total >=  parseInt(req.body.points)){
           console.log('Point is smaller than subtotal');
           cart_discount =  parseInt(req.body.points);
           cart_total = sub_total - cart_discount;
           temp_points = 0; 
           
          }else{
             console.log('Point is greater than subtotal');
             cart_discount = sub_total; 
             cart_total = 0;
             temp_points -= sub_total;
                       
          }

        }

                

        console.log('AFTER');
        console.log('sub total:'+sub_total);
        console.log('cart total:'+cart_total);
        console.log('cart discount:'+cart_discount);
        console.log('temp points:'+ temp_points);
        
        res.render('cart.ejs', {cart:customer[user_id].cart, sub_total:sub_total, user:customer[user_id], cart_total:cart_total, discount:cart_discount, points:temp_points});      
    }
});


app.get('/order', function(req, res){
    let sub_total;
  
    if(!customer[user_id].cart){
        customer[user_id].cart = [];
    }
    if(customer[user_id].cart.length < 1){
        res.send('your cart is empty. back to shop <a href="../shop">shop</a>');
    }else{   
        sub_total = 0;
        customer[user_id].cart.forEach((item) => sub_total += item.total);   

        let item_list = "";
        customer[user_id].cart.forEach((item) => item_list += item.name+'*'+item.qty);  
        
        res.render('order.ejs', {cart:customer[user_id].cart, sub_total:sub_total, user:customer[user_id], cart_total:cart_total, discount:cart_discount, items:item_list});    
    }
});

app.post('/order', function(req, res){
    let today = new Date();


    let data = {
      name: req.body.name,
      phone: req.body.phone,
      address: req.body.address,
      items: req.body.items,
      sub_total: parseInt(req.body.sub_total),
      discount: parseInt(req.body.discount),
      total: parseInt(req.body.total),
      payment_type: req.body.payment_type,
      ref: generateRandom(6),
      created_on: today,
      status: "pending",
      comment:"",      
    }




    db.collection('orders').add(data).then((success)=>{
        
        console.log('TEMP POINTS:', temp_points);
        console.log('CUSTOMER: ', customer[user_id]);

        //get 10% from sub total and add to remaining points;
        let newpoints = temp_points + data.sub_total * 0.1;  

        let update_data = {points: newpoints };

        console.log('update_data: ', update_data);

        db.collection('users').doc(user_id).update(update_data).then((success)=>{
              console.log('POINT UPDATE:');
              let text = "Thank you. Your order has been confirmed. Your order reference number is "+data.ref;      
              let response = {"text": text};
              callSend(user_id, response);       
          
          }).catch((err)=>{
             console.log('Error', err);
          });   
      }).catch((err)=>{
         console.log('Error', err);
      });
});





//webview test
app.get('/webview/:sender_id',function(req,res){
    const sender_id = req.params.sender_id;
    res.render('webview.ejs',{title:"Hello!! from WebView", sender_id:sender_id});
});



app.post('/webview',upload.single('file'),function(req,res){
      
      let name  = req.body.name;
      let email = req.body.email;
      let img_url = "";
      let sender = req.body.sender;  

      console.log("REQ FILE:",req.file);



      let file = req.file;
      if (file) {
        uploadImageToStorage(file).then((img_url) => {
            db.collection('webview').add({
              name: name,
              email: email,
              image: img_url
              }).then(success => {   
                console.log("DATA SAVED")
                thankyouReply(sender, name, img_url);    
              }).catch(error => {
                console.log(error);
              }); 
        }).catch((error) => {
          console.error(error);
        });
      } 
      
           
});

//Set up Get Started Button. To run one time
//eg https://fbstarter.herokuapp.com/setgsbutton
app.get('/setgsbutton',function(req,res){
    setupGetStartedButton(res);    
});

//Set up Persistent Menu. To run one time
//eg https://fbstarter.herokuapp.com/setpersistentmenu
app.get('/setpersistentmenu',function(req,res){
    setupPersistentMenu(res);    
});

//Remove Get Started and Persistent Menu. To run one time
//eg https://fbstarter.herokuapp.com/clear
app.get('/clear',function(req,res){    
    removePersistentMenu(res);
});

//whitelist domains
//eg https://fbstarter.herokuapp.com/whitelists
app.get('/whitelists',function(req,res){    
    whitelistDomains(res);
});


// Accepts GET requests at the /webhook endpoint
app.get('/webhook', (req, res) => {  

  const VERIFY_TOKEN = process.env.VERIFY_TOKEN;  

  let mode = req.query['hub.mode'];
  let token = req.query['hub.verify_token'];
  let challenge = req.query['hub.challenge'];  
    
  // Check token and mode
  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      res.status(200).send(challenge);    
    } else {      
      res.sendStatus(403);      
    }
  }
});

/**********************************************
Function to Handle when user send quick reply message
***********************************************/

function handleQuickReply(sender_psid, received_message) {

  console.log('QUICK REPLY', received_message);

  received_message = received_message.toLowerCase();  

  switch(received_message) {                
      case "register":
          current_question = "q1";
          botQuestions(current_question, sender_psid);
        break;
      case "check-order":         
          current_question = "q4";
          botQuestions(current_question, sender_psid);
        break; 
      case "shop":
          shopMenu(sender_psid);
        break; 
      case "confirm-register":         
            saveRegistration(userInputs[user_id], sender_psid);
        break;  
                 
      default:
          defaultReply(sender_psid);
  }  
 
}

/**********************************************
Function to Handle when user send text message
***********************************************/

const handleMessage = (sender_psid, received_message) => {

  console.log('TEXT REPLY', received_message);
 
  let response;

  if(received_message.attachments){
     handleAttachments(sender_psid, received_message.attachments);
  }else if(current_question == 'q1'){     
     userInputs[user_id].name = received_message.text;
     current_question = 'q2';
     botQuestions(current_question, sender_psid);
  }else if(current_question == 'q2'){    
     userInputs[user_id].phone = received_message.text; 
     current_question = 'q3';
     botQuestions(current_question, sender_psid);
  }else if(current_question == 'q3'){
     userInputs[user_id].address = received_message.text;     
     current_question = '';     
     confirmRegister(sender_psid);
  }else if(current_question == 'q4'){
     let order_ref = received_message.text; 

     console.log('order_ref: ', order_ref);    
     current_question = '';     
     showOrder(sender_psid, order_ref);
  }
  else {
      
      let user_message = received_message.text;      
     
      user_message = user_message.toLowerCase(); 

      switch(user_message) { 

      
      case "start":{
          startGreeting(sender_psid);
        break;
      }              
      case "text":
        textReply(sender_psid);
        break;      
      case "button":                  
        buttonReply(sender_psid);
        break;
      case "webview":
        webviewTest(sender_psid);
        break;      
                    
      default:
          defaultReply(sender_psid);
      }       
          
      
    }

}

/*********************************************
Function to handle when user send attachment
**********************************************/


const handleAttachments = (sender_psid, attachments) => {
  
  console.log('ATTACHMENT', attachments);


  let response; 
  let attachment_url = attachments[0].payload.url;
    response = {
      "attachment": {
        "type": "template",
        "payload": {
          "template_type": "generic",
          "elements": [{
            "title": "Is this the right picture?",
            "subtitle": "Tap a button to answer.",
            "image_url": attachment_url,
            "buttons": [
              {
                "type": "postback",
                "title": "Yes!",
                "payload": "yes-attachment",
              },
              {
                "type": "postback",
                "title": "No!",
                "payload": "no-attachment",
              }
            ],
          }]
        }
      }
    }
    callSend(sender_psid, response);
}


/*********************************************
Function to handle when user click button
**********************************************/
const handlePostback = (sender_psid, received_postback) => { 

  

  let payload = received_postback.payload;

  console.log('BUTTON PAYLOAD', payload);

  
  if(payload.startsWith("Doctor:")){
    let doctor_name = payload.slice(7);
    console.log('SELECTED DOCTOR IS: ', doctor_name);
    userInputs[user_id].doctor = doctor_name;
    console.log('TEST', userInputs);
    firstOrFollowUp(sender_psid);
  }else{

      switch(payload) {        
      case "yes":
          showButtonReplyYes(sender_psid);
        break;
      case "no":
          showButtonReplyNo(sender_psid);
        break;                      
      default:
          defaultReply(sender_psid);
    } 

  }


  
}


const generateRandom = (length) => {
   var result           = '';
   var characters       = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
   var charactersLength = characters.length;
   for ( var i = 0; i < length; i++ ) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
   }
   return result;
}




function webviewTest(sender_psid){
  let response;
  response = {
      "attachment": {
        "type": "template",
        "payload": {
          "template_type": "generic",
          "elements": [{
            "title": "Click to open webview?",                       
            "buttons": [              
              {
                "type": "web_url",
                "title": "webview",
                "url":APP_URL+"webview/"+sender_psid,
                 "webview_height_ratio": "full",
                "messenger_extensions": true,          
              },
              
            ],
          }]
        }
      }
    }
  callSendAPI(sender_psid, response);
}




/**************
startshop
**************/
const botQuestions = (current_question, sender_psid) => {
  if(current_question == 'q1'){
    let response = {"text": bot_questions.q1};
    callSend(sender_psid, response);
  }else if(current_question == 'q2'){
    let response = {"text": bot_questions.q2};
    callSend(sender_psid, response);
  }else if(current_question == 'q3'){
    let response = {"text": bot_questions.q3};
    callSend(sender_psid, response);
  }
  else if(current_question == 'q4'){
    let response = {"text": bot_questions.q4};
    callSend(sender_psid, response);
  }
}

const startGreeting =(sender_psid) => {
  let response = {"text": "Welcome to NAY shop."};
  callSend(sender_psid, response).then(()=>{
    showMenu(sender_psid);
  });  
}

const showMenu = async(sender_psid) => {
  let title = "";
  const userRef = db.collection('users').doc(sender_psid);
    const user = await userRef.get();
    if (!user.exists) {
      title = "Register";  
      first_reg = true;      
    } else {
      title = "Update Profile";  
      first_reg = false;      
    } 


  let response = {
    "text": "Select your reply",
    "quick_replies":[
            {
              "content_type":"text",
              "title":title,
              "payload":"register",              
            },{
              "content_type":"text",
              "title":"Shop",
              "payload":"shop",             
            },
            {
              "content_type":"text",
              "title":"My Order",
              "payload":"check-order",             
            }

    ]
  };
  callSend(sender_psid, response);
}



const confirmRegister = (sender_psid) => {

  let summery = "";
  summery += "name:" + userInputs[user_id].name + "\u000A";
  summery += "phone:" + userInputs[user_id].phone + "\u000A";
  summery += "address:" + userInputs[user_id].address + "\u000A";

  let response1 = {"text": summery};

  let response2 = {
    "text": "Confirm to register",
    "quick_replies":[
            {
              "content_type":"text",
              "title":"Confirm",
              "payload":"confirm-register",              
            },{
              "content_type":"text",
              "title":"Cancel",
              "payload":"off",             
            }
    ]
  };
  
  callSend(sender_psid, response1).then(()=>{
    return callSend(sender_psid, response2);
  });
}

const saveRegistration = (arg, sender_psid) => {

  let data = arg;  

  if(first_reg){
      let today = new Date();
      data.fid = sender_psid;
      data.created_on = today;
      data.points = 50;
      data.status = "pending";
     
  
      db.collection('users').doc(sender_psid).set(data).then((success)=>{
        console.log('SAVED', success);
        //first_reg = false;
        let text = "Thank you. You have been registered."+ "\u000A";      
        let response = {"text": text};
        callSend(sender_psid, response);
      }).catch((err)=>{
         console.log('Error', err);
      });

  }else{
      let update_data = {name:data.name, phone:data.phone, address:data.address};
      db.collection('users').doc(sender_psid).update(update_data).then((success)=>{
      console.log('SAVED', success);
      //first_reg = false;
      let text = "Thank you. You have been registered."+ "\u000A";      
      let response = {"text": text};
      callSend(sender_psid, response);
      }).catch((err)=>{
         console.log('Error', err);
      });

  }
}

const showOrder = async(sender_psid, order_ref) => {

    let cust_points = 0;

    const ordersRef = db.collection('orders').where("ref", "==", order_ref).limit(1);
    const snapshot = await ordersRef.get();

    const userRef = db.collection('users').doc(user_id);
    const user = await userRef.get();
    if (!user.exists) {
      cust_points = 0;           
    } else {                
        cust_points  = user.data().points;          
    } 


    if (snapshot.empty) {
      let response = { "text": "Incorrect order number" };
      callSend(sender_psid, response).then(()=>{
        return startGreeting(sender_psid);
      });
    }else{
          let order = {}

          snapshot.forEach(doc => {      
              order.ref = doc.data().ref;
              order.status = doc.data().status;
              order.comment = doc.data().comment;  
          });


          let response1 = { "text": `Your order ${order.ref} is ${order.status}.` };
          let response2 = { "text": `Seller message: ${order.comment}.` };
          let response3 = { "text": `You have remaining ${cust_points} point(s)` };
            callSend(sender_psid, response1).then(()=>{
              return callSend(sender_psid, response2).then(()=>{
                return callSend(sender_psid, response3)
              });
          });

    }

    

}




const shopMenu =(sender_psid) => {
  let response = {
      "attachment": {
        "type": "template",
        "payload": {
          "template_type": "generic",
          "elements": [{
            "title": "Nay Shop",
            "image_url":"https://img.favpng.com/8/22/6/toy-shop-retail-toys-r-us-clip-art-png-favpng-Q5kvdVUxgvDQT9M9vmsHzByQY.jpg",                       
            "buttons": [              
              {
                "type": "web_url",
                "title": "Shop Now",
                "url":APP_URL+"shop/",
                 "webview_height_ratio": "full",
                "messenger_extensions": true,          
              },
              
            ],
          }]
        }
      }
    }  
  callSend(sender_psid, response);
}


/**************
endshop
**************/

const textReply =(sender_psid) => {
  let response = {"text": "You sent text message"};
  callSend(sender_psid, response);
}


const buttonReply =(sender_psid) => {

  let response = {
      "attachment": {
        "type": "template",
        "payload": {
          "template_type": "generic",
          "elements": [{
            "title": "Are you OK?",
            "image_url":"https://www.mindrops.com/images/nodejs-image.png",                       
            "buttons": [
                {
                  "type": "postback",
                  "title": "Yes!",
                  "payload": "yes",
                },
                {
                  "type": "postback",
                  "title": "No!",
                  "payload": "no",
                }
              ],
          }]
        }
      }
    }

  
  callSend(sender_psid, response);
}

const showButtonReplyYes =(sender_psid) => {
  let response = { "text": "You clicked YES" };
  callSend(sender_psid, response);
}

const showButtonReplyNo =(sender_psid) => {
  let response = { "text": "You clicked NO" };
  callSend(sender_psid, response);
}

const thankyouReply =(sender_psid, name, img_url) => {
  let response = {
      "attachment": {
        "type": "template",
        "payload": {
          "template_type": "generic",
          "elements": [{
            "title": "Thank you! " + name,
            "image_url":img_url,                       
            "buttons": [
                {
                  "type": "postback",
                  "title": "Yes!",
                  "payload": "yes",
                },
                {
                  "type": "postback",
                  "title": "No!",
                  "payload": "no",
                }
              ],
          }]
        }
      }
    }
  callSend(sender_psid, response);
}

function testDelete(sender_psid){
  let response;
  response = {
      "attachment": {
        "type": "template",
        "payload": {
          "template_type": "generic",
          "elements": [{
            "title": "Delete Button Test",                       
            "buttons": [              
              {
                "type": "web_url",
                "title": "enter",
                "url":"https://fbstarter.herokuapp.com/test/",
                 "webview_height_ratio": "full",
                "messenger_extensions": true,          
              },
              
            ],
          }]
        }
      }
    }
  callSendAPI(sender_psid, response);
}

const defaultReply = (sender_psid) => {
  let response1 = {"text": "To test text reply, type 'text'"};
  let response2 = {"text": "To test quick reply, type 'quick'"};
  let response3 = {"text": "To test button reply, type 'button'"};   
  let response4 = {"text": "To test webview, type 'webview'"};
    callSend(sender_psid, response1).then(()=>{
      return callSend(sender_psid, response2).then(()=>{
        return callSend(sender_psid, response3).then(()=>{
          return callSend(sender_psid, response4);
        });
      });
  });  
}

const callSendAPI = (sender_psid, response) => {   
  let request_body = {
    "recipient": {
      "id": sender_psid
    },
    "message": response
  }
  
  return new Promise(resolve => {
    request({
      "uri": "https://graph.facebook.com/v6.0/me/messages",
      "qs": { "access_token": PAGE_ACCESS_TOKEN },
      "method": "POST",
      "json": request_body
    }, (err, res, body) => {
      if (!err) {
        //console.log('RES', res);
        //console.log('BODY', body);
        resolve('message sent!')
      } else {
        console.error("Unable to send message:" + err);
      }
    }); 
  });
}

async function callSend(sender_psid, response){
  let send = await callSendAPI(sender_psid, response);
  return 1;
}


const uploadImageToStorage = (file) => {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject('No image file');
    }
    let newFileName = `${Date.now()}_${file.originalname}`;

    let fileUpload = bucket.file(newFileName);

    const blobStream = fileUpload.createWriteStream({
      metadata: {
        contentType: file.mimetype,
         metadata: {
            firebaseStorageDownloadTokens: uuidv4
          }
      }
    });

    blobStream.on('error', (error) => {
      console.log('BLOB:', error);
      reject('Something is wrong! Unable to upload at the moment.');
    });

    blobStream.on('finish', () => {
      // The public URL can be used to directly access the file via HTTP.
      //const url = format(`https://storage.googleapis.com/${bucket.name}/${fileUpload.name}`);
      const url = format(`https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${fileUpload.name}?alt=media&token=${uuidv4}`);
      console.log("image url:", url);
      resolve(url);
    });

    blobStream.end(file.buffer);
  });
}




/*************************************
FUNCTION TO SET UP GET STARTED BUTTON
**************************************/

const setupGetStartedButton = (res) => {
  let messageData = {"get_started":{"payload":"get_started"}};

  request({
      url: 'https://graph.facebook.com/v2.6/me/messenger_profile?access_token='+ PAGE_ACCESS_TOKEN,
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      form: messageData
    },
    function (error, response, body) {
      if (!error && response.statusCode == 200) {        
        res.send(body);
      } else { 
        // TODO: Handle errors
        res.send(body);
      }
  });
} 

/**********************************
FUNCTION TO SET UP PERSISTENT MENU
***********************************/



const setupPersistentMenu = (res) => {
  var messageData = { 
      "persistent_menu":[
          {
            "locale":"default",
            "composer_input_disabled":false,
            "call_to_actions":[
                {
                  "type":"postback",
                  "title":"View My Tasks",
                  "payload":"view-tasks"
                },
                {
                  "type":"postback",
                  "title":"Add New Task",
                  "payload":"add-task"
                },
                {
                  "type":"postback",
                  "title":"Cancel",
                  "payload":"cancel"
                }
          ]
      },
      {
        "locale":"default",
        "composer_input_disabled":false
      }
    ]          
  };
        
  request({
      url: 'https://graph.facebook.com/v2.6/me/messenger_profile?access_token='+ PAGE_ACCESS_TOKEN,
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      form: messageData
  },
  function (error, response, body) {
      if (!error && response.statusCode == 200) {
          res.send(body);
      } else { 
          res.send(body);
      }
  });
} 

/***********************
FUNCTION TO REMOVE MENU
************************/

const removePersistentMenu = (res) => {
  var messageData = {
          "fields": [
             "persistent_menu" ,
             "get_started"                 
          ]               
  };  
  request({
      url: 'https://graph.facebook.com/v2.6/me/messenger_profile?access_token='+ PAGE_ACCESS_TOKEN,
      method: 'DELETE',
      headers: {'Content-Type': 'application/json'},
      form: messageData
  },
  function (error, response, body) {
      if (!error && response.statusCode == 200) {          
          res.send(body);
      } else {           
          res.send(body);
      }
  });
} 


/***********************************
FUNCTION TO ADD WHITELIST DOMAIN
************************************/

const whitelistDomains = (res) => {
  var messageData = {
          "whitelisted_domains": [
             APP_URL , 
             "https://herokuapp.com" ,                                   
          ]               
  };  
  request({
      url: 'https://graph.facebook.com/v2.6/me/messenger_profile?access_token='+ PAGE_ACCESS_TOKEN,
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      form: messageData
  },
  function (error, response, body) {
      if (!error && response.statusCode == 200) {          
          res.send(body);
      } else {           
          res.send(body);
      }
  });
} 