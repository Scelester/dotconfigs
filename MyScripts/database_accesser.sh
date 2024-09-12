#!/bin/bash


user="scelester"
db="scelester"


db_get(){
    psql -U $user -d $db -t -A -c "SELECT state FROM script_states where name = '$name';"
}

db_set(){
    psql -U $user -d $db -c "UPDATE script_states set state = $state WHERE name='$name';"
}

db_get_data(){
    psql -U $user -d $db -t -A -c "SELECT data FROM local_datas where name = '$name';"
}

db_set_data(){
    psql -U $user -d $db -t -A -c "UPDATE local_datas set data = $data where name = '$name';"
}