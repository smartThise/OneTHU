## Default Permission

OneTHU Android 系统桥：
查询系统桥可用性（下载转存 / intent 深链由主 crate 内部调用，不经 IPC）；
b40 起含系统夜间模式原生信号（system_night_mode）与其变更事件监听（register_listener）。

#### This default permission set includes the following:

- `allow-mobile-supported`
- `allow-mobile-exit`
- `allow-system-night-mode`
- `allow-register-listener`

## Permission Table

<table>
<tr>
<th>Identifier</th>
<th>Description</th>
</tr>


<tr>
<td>

`onethu-mobile:allow-mobile-exit`

</td>
<td>

Enables the mobile_exit command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`onethu-mobile:deny-mobile-exit`

</td>
<td>

Denies the mobile_exit command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`onethu-mobile:allow-mobile-supported`

</td>
<td>

Enables the mobile_supported command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`onethu-mobile:deny-mobile-supported`

</td>
<td>

Denies the mobile_supported command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`onethu-mobile:allow-register-listener`

</td>
<td>

Enables the register_listener command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`onethu-mobile:deny-register-listener`

</td>
<td>

Denies the register_listener command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`onethu-mobile:allow-system-night-mode`

</td>
<td>

Enables the system_night_mode command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`onethu-mobile:deny-system-night-mode`

</td>
<td>

Denies the system_night_mode command without any pre-configured scope.

</td>
</tr>
</table>
