import { initializeApp } from "firebase/app"
import { getFirestore, collection, addDoc } from "firebase/firestore"

const db = getFirestore()

export async function saveMemory(prompt,response){

await addDoc(collection(db,"memory"),{

prompt,
response,
timestamp:Date.now()

})

}
