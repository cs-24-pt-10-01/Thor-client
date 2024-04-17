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
				currentPanel.webview.html = fs.readFileSync('PATH TO HTML (webview.html)', 'utf8');
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
			if (!currentPanel) { //skal testes uden dette
				return;
			}
			currentPanel.webview.postMessage({ command: 'updateGraph', id: id_arg, value: value_arg });
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('thorClient.AddGraph', (id_arg) => {
			if (!currentPanel) { //skal testes uden dette
				return;
			}
			currentPanel.webview.postMessage({ command: 'addGraph', id: id_arg});
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('thorClient.UpdateStats', (id_arg, first_arg, acc_arg, per_call_arg) => {
			if (!currentPanel) { //skal testes uden dette
				return;
			}
			currentPanel.webview.postMessage({ command: 'updateStats', id: id_arg, first: first_arg, acc: acc_arg, per_call: per_call_arg});
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand('thorClient.SocketClosed', (dict_arg) => {
			if (!currentPanel) { //skal testes uden dette
				return;
			}
			currentPanel.webview.postMessage({ command: 'SocketClosed', dict: dict_arg});
		})
	);

}


var idThreadDict = {};
var dict = {}; //data about the different measurements
//dict[0]: Energy used in first iteration
//dict[1]: total energy used
//dict[2]: count (amount of emasurements taken)
//dict[3]: identifier

function startSocket(){
	const host = "127.0.0.1";
	const port = 5000;


	const client = net.createConnection(port, host, () => {
		console.log("Connected");
		client.write(`gib,something`);
	});

	client.on("data", (data) => {

		var jsonData = JSON.parse(data.toString());
		
		for(var stuff in jsonData){

			var val = jsonData[stuff];

			var identifier = val.local_client_packet.id;
			var threadId = val.local_client_packet.thread_id;
			var value = val.rapl_measurement.Intel.pkg;
			var operation = val.local_client_packet.operation;

			var key = identifier+threadId;
			if(operation == "Start"){
				idThreadDict.key = value;
			}else{
				var energyUsed = value - idThreadDict.key;

				if(!(identifier in dict)){
					vscode.commands.executeCommand('thorClient.AddGraph', identifier);
					//				   [first, accumulated, amount of times seen, identifier(used for debugging)] //TODO remove debug identifier
					dict[identifier] = [energyUsed, 0, 0, identifier];
				}
				
				vscode.commands.executeCommand('thorClient.UpdateGraph', identifier, energyUsed);

				dict[identifier][1] += energyUsed;
				dict[identifier][2] += 1;
				vscode.commands.executeCommand('thorClient.UpdateStats', identifier, dict[identifier][0], dict[identifier][1], ((dict[identifier][1])/(dict[identifier][2])));
			}
		}

	});

	client.on("error", (error) => {
		console.log("made a mistake");
		console.log(`Error: ${error.message}`);
	});

	client.on("close", () => {
		vscode.commands.executeCommand('thorClient.SocketClosed', dict);
		console.log("Connection closed");
	});
}


// This method is called when your extension is deactivated
function deactivate() {}


module.exports = {
	activate,
	deactivate
}