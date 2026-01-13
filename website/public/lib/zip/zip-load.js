// (function(obj) {
//
// 	var requestFileSystem = obj.webkitRequestFileSystem || obj.mozRequestFileSystem || obj.requestFileSystem;
//
// 	function onerror(message) {
// 		alert(message);
// 	}
//
// 	function createTempFile(callback) {
// 		var tmpFilename = "tmp.dat";
// 		requestFileSystem(TEMPORARY, 4 * 1024 * 1024 * 1024, function(filesystem) {
// 			function create() {
// 				filesystem.root.getFile(tmpFilename, {
// 					create : true
// 				}, function(zipFile) {
// 					callback(zipFile);
// 				});
// 			}
//
// 			filesystem.root.getFile(tmpFilename, null, function(entry) {
// 				entry.remove(create, create);
// 			}, create);
// 		});
// 	}
//
// 	var model = (function() {
// 		var URL = obj.mozURL || obj.URL;
//
// 		return {
// 			getEntries : function(file, onend) {
// 				zip.createReader(new zip.BlobReader(file), function(zipReader) {
// 					zipReader.getEntries(onend);
// 				}, onerror);
// 			},
// 			getEntryFile : function(entry, creationMethod, onend, onprogress) {
// 				var writer, zipFileEntry;
//
// 				function getData() {
// 					entry.getData(writer, function(blob) {
// 						var blobURL = creationMethod == "Blob" ? URL.createObjectURL(blob) : zipFileEntry.toURL();
// 						onend(blobURL);
// 					}, onprogress);
// 				}
//
// 				if (creationMethod == "Blob") {
// 					writer = new zip.BlobWriter();
// 					getData();
// 				} else {
// 					createTempFile(function(fileEntry) {
// 						zipFileEntry = fileEntry;
// 						writer = new zip.FileWriter(zipFileEntry);
// 						getData();
// 					});
// 				}
// 			},
// 			getEntryFileData : function(entry, creationMethod, onend, onprogress) {
// 				var writer, zipFileEntry;
//
// 				function getData() {
// 					entry.getData(writer, function(blob) {
// 						var blobURL = creationMethod == "Blob" ? URL.createObjectURL(blob) : zipFileEntry.toURL();
// 						onend(blobURL);
// 					}, onprogress);
// 				}
//
// 				if (creationMethod == "Blob") {
// 					writer = new zip.BlobWriter();
// 					return getData();
// 				} else {
// 					createTempFile(function(fileEntry) {
// 						zipFileEntry = fileEntry;
// 						writer = new zip.FileWriter(zipFileEntry);
// 						 onend(getData());
// 					});
// 				}
// 			}
// 		};
// 	})();
//
// 	(function() {
// 		var fileInput = document.getElementById("file-input");
// 		var unzipProgress = document.createElement("progress");
// 		var fileList = document.getElementById("file-list");
// 		var creationMethodInput = document.getElementById("creation-method-input");
//
// 		function download(entry, li, a) {
// 			model.getEntryFile(entry, creationMethodInput.value, function(blobURL) {
// 				// create the click event
// 				var clickEvent = document.createEvent("MouseEvent");
// 				// when finished unzip, remove child node
// 				if (unzipProgress.parentNode)
// 					unzipProgress.parentNode.removeChild(unzipProgress);
// 				// unzip progress initialize at 0
// 				unzipProgress.value = 0;
// 				unzipProgress.max = 0;
// 				// add mouse event to click event
// 				clickEvent.initMouseEvent("click", true, true, window, 0, 0, 0, 0, 0, false, false, false, false, 0, null);
// 				// 'a href' tag gets updated with the blob url to the file data
// 				a.href = blobURL;
// 				// 'download' tag gets updated with original entry filename
// 				a.download = entry.filename;
// 				// dispatch and execute the click event
// 				a.dispatchEvent(clickEvent);
// 			}, function(current, total) {
// 				// start unzipping and track the progress
// 				unzipProgress.value = current;
// 				unzipProgress.max = total;
// 				li.appendChild(unzipProgress);
// 			});
// 		}
//
// 		// MAY USE LATER TO CREATE ALL DOWNLOAD LINKS INITIALLY INSTEAD OF WAITING FOR CLICK EVENT
// 		function getWithoutDownload(entry, li, a) {
// 			model.getEntryFileData(entry, creationMethodInput.value, function(blobURL) {
// 				if (unzipProgress.parentNode)
// 					unzipProgress.parentNode.removeChild(unzipProgress);
// 				unzipProgress.value = 0;
// 				unzipProgress.max = 0;
// 				a.href = blobURL;
// 				a.download = entry.filename;
// 			}, function(current, total) {
// 				unzipProgress.value = current;
// 				unzipProgress.max = total;
// 				li.appendChild(unzipProgress);
// 			});
// 		}
//
// 		if (typeof requestFileSystem == "undefined")
// 			creationMethodInput.options.length = 1;
// 		// if a zip file is chosen, then the event triggers
// 		fileInput.addEventListener('change', function() {
// 			// disable the file input after a file has been chosen.
// 			fileInput.disabled = true;
// 			// get a list of file entries inside this zip
// 			model.getEntries(fileInput.files[0], function(entries) {
// 				fileList.innerHTML = "";
// 				// loop for each file in the zip
// 				entries.forEach(function(entry) {
// 					var li = document.createElement("li");
// 					var a = document.createElement("a");
// 					// display the name of the file in the page
// 					a.textContent = entry.filename;
// 					// defaults link to nothing until click even is activated.
// 					a.href = "#";
// 					// when user clicks on file name in list, then trigger download file
// 					a.addEventListener("click", function(event) {
// 						// if click even activated, and file has not been downloaded yet, then go get data, create download link, and download
// 						if (!a.download) {
// 							download(entry, li, a);
// 							event.preventDefault();
// 							return false;
// 						}
// 						// if file was already downloaded, then skip the legwork and go straight to downloading the file
// 					}, false);
// 					// check if this is the jsonld file. If it is, we want to load the data into the sesson storage.
// 					if(entry.filename.indexOf(".jsonld") >= 0){
// 			      // get the data from the jsonld file, and set it to the sessionStorage
// 			    	entry.getData(new zip.TextWriter(), function(text) {
// 			        // text contains the entry data as a String
// 							sessionStorage.setItem("metadata", text);
// 			      }, function(current, total) {
// 			        // onprogress callback
// 			      });
// 					}
//
// 					// replace 'a'  tag with our new modified 'a' tag
// 					li.appendChild(a);
// 					// replace 'li' tag with new modified 'li' tag
// 					fileList.appendChild(li);
// 				});
// 			});
// 			// once the change even has triggered, it cannot be triggered again until page refreshes.
// 		}, false);
// 	})();
//
// })(this);
