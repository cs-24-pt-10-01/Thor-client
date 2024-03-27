const vscode = require('vscode');
const net = require("net");
const fs = require("fs");

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

	let currentPanel = undefined;

	context.subscriptions.push(
		vscode.commands.registerCommand('thorClient.start', () => {
			if (currentPanel) {
				currentPanel.reveal(vscode.ViewColumn.One);
			} else {
				currentPanel = vscode.window.createWebviewPanel(
				'thorclient',
				'Thor Client',
				vscode.ViewColumn.One,
				{
					enableScripts: true
				}
				);
				currentPanel.webview.html = fs.readFileSync("	PATH TO webview.html	", "utf8");
				currentPanel.onDidDispose(
				() => {
					currentPanel = undefined;
				},
				undefined,
				context.subscriptions
				);
			}

			currentPanel.webview.onDidReceiveMessage(
				message => {
					switch (message.command) {
					case 'startSocket':
						startSocket();
						return;
					}
				},
				undefined,
				context.subscriptions
			);
		})
		
	);


	context.subscriptions.push(
		vscode.commands.registerCommand('thorClient.startSocket', () => {
			startSocket();
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('thorClient.UpdateGraph', (id_arg, value_arg) => {
			if (!currentPanel) {
				return;
			}
			currentPanel.webview.postMessage({ command: 'updateGraph', id: id_arg, value: value_arg });
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('thorClient.AddGraph', (id_arg) => {
			if (!currentPanel) {
				return;
			}
			currentPanel.webview.postMessage({ command: 'addGraph', id: id_arg});
		})
	);
}


var jsonString = "";
var idThreadDict = {};
var dict = {};


function startSocket(){
	const host = "127.0.0.1";
	const port = 5000;


	const client = net.createConnection(port, host, () => {
		console.log("Connected");
		client.write(`gib,something`);
	});

	client.on("data", (data) => {

		//since a message can be split into multiple messages they have to be assembled into one before it can be parsed as JSON
		if(data.subarray(data.length-1) == "]"){
			jsonString += data;
			var jsonData = JSON.parse(jsonString);
			jsonString = "";

			for(var stuff in jsonData){
				var val = jsonData[stuff];
				
				var identifier = val.local_client_packet.id;
				var threadId = val.local_client_packet.thread_id;
				var value = val.rapl_measurement.AMD.pkg;
				var operation = val.local_client_packet.operation;

				if(!(identifier in dict)){
					vscode.commands.executeCommand('thorClient.AddGraph', identifier);
				}


				if(!(identifier in dict)){
					//				  [first, accumulated, amount of times seen]
					dict[identifier] = [value, value, 1];
				}else{
					dict[identifier][1] += value;
					if(operation == "Stop"){
						dict[identifier][2] += 1;
					}
				}

				var key = identifier+threadId;
				if(operation == "Start"){
					idThreadDict.key = value;
				}else{
					vscode.commands.executeCommand('thorClient.UpdateGraph', identifier, value - idThreadDict.key);
				}
				
				
        	}
		}else{
			jsonString += data;
		}

		
		

	});

	client.on("error", (error) => {
		console.log("made a mistake");
		console.log(`Error: ${error.message}`);
	});

	client.on("close", () => {
		console.log("Connection closed");
	});
}


// This method is called when your extension is deactivated
function deactivate() {}


module.exports = {
	activate,
	deactivate
}